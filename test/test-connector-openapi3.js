// Copyright IBM Corp. 2019. All Rights Reserved.
// Node module: loopback-connector-openapi
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const assert = require('assert');
const should = require('should');
const loopback = require('loopback');
const pEvent = require('p-event');

describe('swagger connector for OpenApi 3.0', () => {
  let lb4App;
  let specUrl = 'http://127.0.0.1:3000/openapi.json';

  before(startLB4App);
  after(stopLB4App);

  describe('OpenAPI spec validation against OpenAPI 3.0 specification', () => {
    it('reports error if required settings are missing', async () => {
      await createDataSource(
        {openapi: '3.0.0'},
        {validate: false},
      ).should.be.rejected();
    });

    it('creates `client.apis` upon datasource creation', async () => {
      const ds = await createDataSource(specUrl);
      ds.connector.should.have.property('client');
      ds.connector.client.should.have.property('apis');
    });
  });

  describe('openapi client generation', () => {
    it('generates client from openapi spec url', async () => {
      const ds = await createDataSource(specUrl);
      ds.connector.should.have.property('client');
      ds.connector.client.should.have.property('apis');
    });

    it('generates client from local openapi spec - .json file', async () => {
      const ds = await createDataSource('test/fixtures/3.0/ping.json');
      ds.connector.should.have.property('client');
      ds.connector.client.should.have.property('apis');
    });

    it('generates client from local openapi spec - .yaml file', async () => {
      const ds = await createDataSource('test/fixtures/3.0/ping.yaml');
      ds.connector.should.have.property('client');
      ds.connector.client.should.have.property('apis');
    });

    it('generates client from openapi spec object', async () => {
      const ds = await createDataSource(require('./fixtures/3.0/ping.json'));
      ds.connector.should.have.property('client');
      ds.connector.client.should.have.property('apis');
    });
  });

  describe('models', () => {
    let ds, Todo;
    /*
     * Undefined filter crashes swagger-client 9.x
     * { filter: undefined } filter
     * at node_modules/swagger-client/dist/index.js:711:13
     * at Array.reduce (<anonymous>)
     * at encodeFormOrQuery (node_modules/swagger-client/dist/index.js:707:43)
     * at mergeInQueryOrForm (node_modules/swagger-client/dist/index.js:764:39)
     * at Object.buildRequest (node_modules/swagger-client/dist/index.js:3945:3)
     * at Function.execute (node_modules/swagger-client/dist/index.js:3760:30)
     * at Swagger.execute (node_modules/swagger-client/dist/index.js:4114:20)
     * at node_modules/swagger-client/dist/index.js:2843:24
     * at Object.<anonymous> (lib/openapi-connector.js:221:14)
     */
    const filter = {};

    before(async () => {
      ds = await createDataSource(specUrl);
      Todo = ds.createModel('Todo', {}, {base: 'Model'});
    });

    it('creates models', function(done) {
      (typeof Todo.TodoController_findTodos).should.eql('function');
      done();
    });

    it('supports model methods', function(done) {
      Todo.TodoController_findTodos({filter}, function(err, res) {
        if (err) return done(err);
        res.status.should.eql(200);
        done();
      });
    });

    it('supports model methods returning a Promise', done => {
      Todo.TodoController_findTodos({filter}).then(function onSuccess(res) {
        res.should.have.property('status', 200);
        done();
      }, /* on error */ done);
    });

    it('supports model methods by x-operation-name', done => {
      Todo.findTodos({filter}).then(function onSuccess(res) {
        res.should.have.property('status', 200);
        done();
      }, /* on error */ done);
    });

    it('exports apis by tag', done => {
      Todo.apis.TodoController.findTodos({filter}).then(function onSuccess(res) {
        res.should.have.property('status', 200);
        done();
      }, /* on error */ done);
    });

    it('allows models to be attached before the spec is loaded', async () => {
      const ds = await createDataSource('test/fixtures/3.0/ping.json');
      const Ping = ds.createModel('Ping', {});
      should(Object.keys(Ping)).containEql('get_ping');
      should(typeof Ping.get_ping).eql('function');
    });

    describe('Swagger invocations', () => {
      it('invokes the createTodo', async () => {
        const res = await Todo.TodoController_createTodo(
          {},
          {
            requestBody: {
              title: 'My todo',
            },
          },
        );

        res.status.should.eql(200);
        res.body.should.eql({id: 1, title: 'My todo'});
      });

      it('supports positional invocation', async () => {
        const ds = await createDataSource(specUrl, {positional: true});
        const Todo = ds.createModel('Todo', {}, {base: 'Model'});
        let res = await Todo.TodoController_createTodo({
          title: 'My todo 2',
        });

        res.status.should.eql(200);
        res.body.should.eql({id: 2, title: 'My todo 2'});

        res = await Todo.TodoController_findTodoById(2, {});
        res.status.should.eql(200);
        res.body.should.eql({id: 2, title: 'My todo 2'});
      });

      it('invokes the findTodos', async () => {
        const res = await Todo.TodoController_findTodos({filter});
        res.status.should.eql(200);
        res.body.should.eql([
          {id: 1, title: 'My todo'},
          {id: 2, title: 'My todo 2'},
        ]);
      });

      it('invokes connector-hooks', async () => {
        const events = [];
        const connector = ds.connector;
        connector.observe('before execute', function(ctx, next) {
          assert(ctx.req);
          events.push('before execute');
          next();
        });
        connector.observe('after execute', function(ctx, next) {
          assert(ctx.res);
          events.push('after execute');
          next();
        });
        await Todo.TodoController_findTodos({filter});
        assert.deepEqual(events, ['before execute', 'after execute']);
      });

      it('supports Promise-based connector-hooks', async () => {
        const events = [];
        const connector = ds.connector;

        connector.observe('before execute', ctx => {
          events.push('before execute');
          return Promise.resolve();
        });

        connector.observe('after execute', ctx => {
          events.push('after execute');
          return Promise.resolve();
        });

        await Todo.TodoController_findTodos({filter});
        assert.deepEqual(events, ['before execute', 'after execute']);
      });
    });
  });

  async function startLB4App() {
    const TodoListApplication = require('@loopback/example-todo')
      .TodoListApplication;
    const config = {
      rest: {
        port: 0,
        host: '127.0.0.1',
        openApiSpec: {
          // useful when used with OASGraph to locate your application
          setServersFromRequest: true,
        },
      },
    };
    lb4App = new TodoListApplication(config);
    lb4App.bind('datasources.config.db').to({connector: 'memory'});
    await lb4App.boot();
    await lb4App.start();
    specUrl = lb4App.restServer.url + '/openapi.json';
  }

  async function stopLB4App() {
    if (!lb4App) return;
    await lb4App.stop();
  }
});

async function createDataSource(spec, options) {
  const config = Object.assign(
    {
      connector: require('../index'),
      spec: spec,
    },
    options,
  );
  const ds = loopback.createDataSource('openapi', config);
  await pEvent(ds, 'connected');
  return ds;
}
