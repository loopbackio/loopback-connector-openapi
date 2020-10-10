// Copyright IBM Corp. 2019. All Rights Reserved.
// Node module: loopback-connector-openapi
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const assert = require('assert');
const debug = require('debug')('loopback:connector:openapi');
const SpecResolver = require('./spec-resolver');
const VERSION = require('../package.json').version;
const SwaggerClient = require('swagger-client');
const qs = require('querystring');
const util = require('util');
const fetch = require('node-fetch');
const _ = require('lodash');
const swagger2openapi = require('swagger2openapi');

exports.SwaggerClient = SwaggerClient;

/**
 * Export the initialize method to loopback-datasource-juggler
 * @param {DataSource} dataSource The dataSource object
 * @param callback
 */
exports.initialize = function initializeDataSource(dataSource, callback) {
  const settings = dataSource.settings || {};

  if (settings.cache) {
    assert(settings.cache.model, '"cache.model" setting is required');
    assert(!!settings.cache.ttl, '"cache.ttl" setting is required');
    assert(settings.cache.ttl > 0, '"cache.ttl" must be a positive number');
  }

  const connector = new OpenApiConnector(settings);

  dataSource.connector = connector;
  dataSource.connector.dataSource = dataSource;
  // Call dataSource.connect to ensure state (connecting/connected) is consistent
  dataSource.connect(callback);
};

/**
 * The OpenApiConnector constructor
 * @param {Object} settings The connector settings
 * @constructor
 */
function OpenApiConnector(settings) {
  settings = settings || {};
  if (settings.transformResponse === true) {
    settings.transformResponse = transformResponse;
  }
  this.settings = settings;
  this.url = settings.url;
  this.spec = settings.spec;
  this.cache = settings.cache;
  this.connectorHooks = new ConnectorHooks();

  if (debug.enabled) {
    debug('Settings: %j', settings);
  }

  this._models = {};
  this.DataAccessObject = function() {
    // Dummy function
  };
}

/**
 * Parse swagger specification, setup client and export client
 * @param {Function} callback function
 * @prototype
 */
OpenApiConnector.prototype.connect = function(cb) {
  const self = this;

  if (self.client) {
    process.nextTick(() => {
      if (cb) cb(null, self.client);
    });
    return;
  }

  if (!self.spec) {
    process.nextTick(() => {
      cb(new Error('No swagger specification provided'), null);
    });
    return;
  }

  const validate = !!self.settings.validate;
  new SpecResolver().resolve(
    self.spec,
    {
      validate: {schema: validate, spec: validate},
      // Ignore circular references
      dereference: {circular: 'ignore'},
    },
    async function(err, api) {
      if (err) return cb(err, null);

      if (debug.enabled) {
        debug('Reading swagger specification from: %j', self.spec);
      }

      let error = null;
      let client;
      try {
        if (self.settings.forceOpenApi30 && api.swagger === '2.0') {
          const options = await swagger2openapi.convertObj(api, {
            patch: true,
            anchors: true,
          });
          api = options.openapi;
        }
        self.api = api;
        self.setupConnectorHooks();
        const httpClient = (request) => {
          request = {...self.settings.httpClientOptions, ...request};
          return SwaggerClient.http(request);
        };
        const req = {
          url: self.url,
          spec: api,
          http: self.settings.httpClient || httpClient,
          userFetch: self.settings.userFetch || fetch,
          authorizations: self.settings.authorizations || {},
          requestInterceptor: self.connectorHooks.beforeExecute,
          responseInterceptor: self.connectorHooks.afterExecute,
        };

        client = await SwaggerClient(req);
        if (debug.enabled) {
          debug('swagger loaded: %s', self.spec);
        }

        client.connector = self;
        self.client = client;
        self.setupDataAccessObject();
      } catch (err) {
        error = err;
      }
      cb(error, client);
    },
  );
};

// Parse swagger specification, setup client and export client

OpenApiConnector.prototype.setupDataAccessObject = function() {
  if (this.specParsed && this.DataAccessObject) {
    return this.DataAccessObject;
  }

  this.specParsed = true;

  const getMethodNames = this.settings.mapToMethods || mapToMethods;
  const existingNames = Object.keys(this.DataAccessObject);

  const apis = {};
  for (const tag in this.client.apis) {
    const operationsForTag = this.client.apis[tag];
    apis[tag] = {};

    for (const operationId in operationsForTag) {
      const opSpec = this.getOperationSpec(operationId);
      const method = operationsForTag[operationId];

      if (opSpec.operationId == null) {
        opSpec.operationId = operationId;
      }

      let methodNames = getMethodNames(tag, opSpec, existingNames);
      methodNames = normalizeMethods(methodNames);

      if (debug.enabled) {
        debug(
          'Adding methods for operation %s as %s',
          operationId,
          methodNames,
        );
      }

      const wrapper = this.createWrapper(method, opSpec, this.settings);
      const swaggerMethod = wrapper.bind(operationsForTag);
      // TODO: gunjpan: support remotingEnabled
      // const swaggerOp = api.apis[o];
      // if (this.settings.remotingEnabled) {
      //   remoting.setRemoting.call(swaggerMethod, swaggerOp);
      // }
      // Set findTodos()
      for (const m of methodNames) {
        this.DataAccessObject[m] = swaggerMethod;
      }

      let methodNamesWithinTag = getMethodNames(undefined, opSpec);
      methodNamesWithinTag = normalizeMethods(methodNamesWithinTag);
      if (debug.enabled) {
        debug(
          'Adding apis[%s] for operation %s as %s',
          tag,
          operationId,
          methodNamesWithinTag,
        );
      }
      for (const m of methodNamesWithinTag) {
        // Set apis.TodoController.findTodos
        apis[tag][m] = swaggerMethod;
      }
    }
    // Expose apis
    this.DataAccessObject.apis = apis;
  }

  this.DataAccessObject.execute = (operationId, parameters, options) => {
    const request = {
      operationId,
      parameters,
    };
    Object.assign(request, options);
    return this.client.execute(request);
  };

  this.dataSource.DataAccessObject = this.DataAccessObject;

  for (const model in this._models) {
    if (debug.enabled) {
      debug('Mixing methods into : %s', model);
    }
    this.dataSource.mixin(this._models[model].model);
  }
  return this.DataAccessObject;
};

/**
 * Get the method name for an operation
 * @param {string} tag - The tag. It will be undefined for tagged interfaces.
 * @param {object} operationSpec - Operation spec
 * @param {string[]} existingNames - Optional array to track used names
 *
 * @returns A method name or an array of method names. Return undefined to
 * skip the operation.
 */
function mapToMethods(tag, operationSpec, existingNames) {
  const methods = [];
  const addMethods = (...names) => {
    for (const name of names) {
      if (!name) break;
      if (methods.includes(name)) break;
      methods.push(name);
    }
  };
  const opName = operationSpec['x-operation-name'];
  const opId = operationSpec.operationId;

  // Add simple names
  addMethods(opName, _.camelCase(opName));
  addMethods(opId, _.camelCase(opId));

  // Add full names
  if (tag && opName) {
    const name = `${tag}_${opName}`;
    addMethods(name, _.camelCase(name));
  }
  if (tag && opId) {
    const name = `${tag}_${opId}`;
    addMethods(name, _.camelCase(opId));
  }

  if (existingNames == null) return methods;
  return methods.filter((m) => {
    if (existingNames.includes(m)) return false;
    existingNames.push(m);
    return true;
  });
}

function normalizeMethods(methodNames) {
  if (typeof methodNames === 'string') {
    methodNames = [methodNames];
  }
  if (!Array.isArray(methodNames)) {
    methodNames = [];
  }
  return methodNames;
}

function transformResponse(res, operationSpec) {
  if (res.status < 400) {
    return res.body;
  }
  const err = new Error(`${res.status} ${res.statusText}`);
  err.details = res;
  throw err;
}

OpenApiConnector.prototype.createWrapper = function(
  method,
  operation,
) {
  const options = this.settings;
  if (options.transformResponse === true) {
    options.transformResponse = transformResponse;
  }
  // Force body to be the last argument for swagger 2.0
  const swagger20 = this.api.swagger === '2.0';
  const isBodyParam = (p) =>
    swagger20 && options.positional === 'bodyLast' && p.in === 'body';

  const methodWithCallback = util.callbackify(method);
  const opParams = operation.parameters || [];

  // Arg names without body
  const argNames = opParams
    .filter((p) => !isBodyParam(p))
    .map((p) => p.name);

  // Add body as the last arg
  let bodyName = '';
  let bodyParam;
  if (swagger20) {
    bodyParam = opParams.filter(isBodyParam)[0];
    if (bodyParam != null) {
      bodyName = bodyParam.name;
      argNames.push(bodyName);
    }
  } else if (operation.requestBody) {
    argNames.push('requestBody');
  }
  return function(...args) {
    let callbackFn;
    if (args.length >= 1 && typeof args[args.length - 1] === 'function') {
      callbackFn = args[args.length - 1];
      args.pop();
    }
    let params = args[0] || {};
    let opts = args[1] || {};
    if (options.positional) {
      params = {};
      // We allow an optional `options` argument for
      // https://github.com/swagger-api/swagger-js/blob/master/docs/usage/try-it-out-executor.md
      // https://github.com/swagger-api/swagger-js/blob/master/docs/usage/tags-interface.md
      // Especially `requestContentType`, `responseContentType`, `authorizations`
      opts = {...args[argNames.length]};
      for (let i = 0; i < argNames.length; i++) {
        const name = argNames[i];
        if (
          !name ||
          (!swagger20 && i === argNames.length - 1 && name === 'requestBody')
        )
          continue;
        params[name] = args[i];
      }
      // `node-fetch` does not support JSON object directly. We have to
      // call `JSON.stringify` to force it.
      if (bodyName && bodyParam) {
        if (params[bodyName] != null) {
          if (
            opts.requestContentType === 'application/json' ||
            (Array.isArray(operation.consumes) &&
              operation.consumes.includes('application/json')) ||
            operation.consumes.length === 0
          ) {
            params[bodyName] = JSON.stringify(params[bodyName]);
          }
        }
      }
      if (!swagger20 && operation.requestBody) {
        opts.requestBody = args[argNames.length - 1];
        if (typeof opts.requestBody != null) {
          if (
            opts.requestContentType === 'application/json' ||
            (operation.requestBody.content &&
              operation.requestBody.content['application/json'])
          ) {
            opts.requestBody = JSON.stringify(opts.requestBody);
          }
        }
      }
    }
    if (callbackFn) {
      const cb = (err, res) => {
        if (err || typeof options.transformResponse !== 'function') {
          return callbackFn(err, res);
        }
        try {
          res = options.transformResponse(res, operation);
          return callbackFn(err, res);
        } catch (err) {
          return callbackFn(err, res);
        }
      };
      // Callback style
      return methodWithCallback(params, opts, cb);
    } else {
      const resolve = (res) => {
        if (typeof options.transformResponse !== 'function') return res;
        return options.transformResponse(res, operation);
      };
      return method(params, opts).then(resolve);
    }
  };
};

/**
 * Match the method name from SwaggerClient interfaces to corresponding
 * Operation spec object
 */
OpenApiConnector.prototype.getOperationSpec = function(methodName) {
  for (const p in this.api.paths) {
    for (const v in this.api.paths[p]) {
      const op = this.api.paths[p][v];
      const id = SwaggerClient.helpers.opId(op, p, v);
      if (id === methodName) return op;
    }
  }
};

/**
 * Hook for defining a model by the data source
 * @param {object} modelDef The model description
 */
OpenApiConnector.prototype.define = function(modelDef) {
  const modelName = modelDef.model.modelName;
  this._models[modelName] = modelDef;
};

// Setup connector hooks around execute operation
OpenApiConnector.prototype.setupConnectorHooks = function() {
  const self = this;
  self.connectorHooks.beforeExecute = function requestInterceptor(req) {
    req.headers['User-Agent'] = 'loopback-connector-openapi/' + VERSION;

    function responseInterceptor(res) {
      const afterResponse = function(data, cb) {
        const ctx = {res: data};
        self.notifyObserversOf('after execute', ctx, function(err) {
          if (err) return cb(err);
          data = ctx.res;
          self._updateCache(req, res, function(err) {
            if (err) cb(err);
            else cb(null, res);
          });
        });
      };
      return util.promisify(afterResponse)(res.body);
    }

    function beforeSend(cb) {
      const ctx = {req: req};
      self.notifyObserversOf('before execute', ctx, function(err) {
        if (err) return cb(err);
        req = ctx.req;
        // Set up a response interceptor for the given request
        req.responseInterceptor = responseInterceptor;
        self._checkCache(req, function(err, cachedResponse) {
          if (err) return cb(err);
          if (cachedResponse) {
            // Set up a custom `userFetch` to return response directly
            // from the cache
            req.userFetch = () => {
              const headers = cachedResponse.headers;
              cachedResponse.headers = new Map();

              for (const h in headers) {
                cachedResponse.headers.set(h, headers[h]);
              }
              const value = cachedResponse.text;
              cachedResponse.text = () => Promise.resolve(value);
              cachedResponse.buffer = () => Promise.resolve(value);
              return Promise.resolve(cachedResponse);
            };
          }
          cb(null, req);
        });
      });
    }

    return util.promisify(beforeSend)();
  };
};

OpenApiConnector.prototype._checkCache = function(req, cb) {
  const Cache = this._getCacheModel();
  if (!Cache) return cb();

  const key = this._getCacheKey(req);
  if (!key) return cb();

  Cache.get(key, (err, value) => {
    if (err) return cb(err);
    if (!value) return cb();

    debug('Returning cached response for %s', key, value);
    return cb(null, value);
  });
};

OpenApiConnector.prototype._updateCache = function(req, res, cb) {
  const Cache = this._getCacheModel();
  if (!Cache) return cb();

  const key = this._getCacheKey(req);
  if (!key) return cb();

  Cache.set(key, res, {ttl: this.settings.cache.ttl}, cb);
};

OpenApiConnector.prototype._getCacheKey = function(req) {
  if (req.method.toLowerCase() !== 'get') return null;

  const base = req.url.replace(/^[^:]+:\/\/[^\/]+/, '');
  const headers = qs.stringify(req.headers);
  return base + ';' + headers;
};

OpenApiConnector.prototype._getCacheModel = function() {
  if (!this.cache) return null;
  let Model = this.cache.model;
  if (typeof Model === 'function' || Model === null) return Model;

  const modelName = Model;
  Model = this.dataSource.modelBuilder.getModel(modelName);
  if (!Model) {
    // NOTE(bajtos) Unfortunately LoopBack does not propagate the datasource
    // name used in the app registry down to the DataSource object
    // As a workaround, we can use Swagger service name and URL instead
    const title = this.client.info && this.client.info.title;
    const url =
      this.client.scheme +
      '://' +
      this.client.host +
      '/' +
      this.client.basePath;
    const name = title ? `"${title}" (${url})` : url;

    console.warn(
      'Model %j not found, caching is disabled for Swagger datasource %s',
      modelName,
      name,
    );
    Model = null;
  }

  this.cache.model = Model;
  return Model;
};

/**
 * The ConnectorHooks constructor
 * @constructor
 */

function ConnectorHooks() {
  if (!(this instanceof ConnectorHooks)) {
    return new ConnectorHooks();
  }

  this.beforeExecute = {
    apply: function() {
      // dummy function
    },
  };
  this.afterExecute = {
    apply: function() {
      // dummy function
    },
  };
}
