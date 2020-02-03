// Copyright IBM Corp. 2016,2019. All Rights Reserved.
// Node module: loopback-connector-openapi
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const SwaggerParser = require('swagger-parser');

function SpecResolver() {
  this.parser = new SwaggerParser();
}

SpecResolver.prototype.resolve = function resolveSpec(spec, options, cb) {
  if (typeof options === 'function' && !cb) {
    cb = options;
  }
  options = Object.assign({validate: {schema: false, spec: false}}, options);
  return this.parser.validate(spec, options, cb);
};

SpecResolver.prototype.validate = function validateSpec(spec, cb) {
  return this.parser.validate(spec, {validate: {spec: true, schema: true}}, cb);
};

module.exports = SpecResolver;
