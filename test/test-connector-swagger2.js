// Copyright IBM Corp. 2019. All Rights Reserved.
// Node module: loopback-connector-openapi
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const assert = require('assert');
const should = require('should');
const loopback = require('loopback');
const pEvent = require('p-event');

describe('OpenAPI connector for Swagger 2.0', function() {
  describe('swagger spec validation against Swagger 2.0 specification', function() {
    it('reports error if required settings are missing', async () => {
      await createDataSource(
        {swagger: {version: '2.0'}},
        {validate: false},
      ).should.be.rejected();
    });

    it('creates `client.apis` upon datasource creation', async () => {
      const ds = await createDataSource(
        'http://petstore.swagger.io/v2/swagger.json',
      );

      ds.connector.should.have.property('client');
      ds.connector.client.should.have.property('apis');
    });
  });

  describe('swagger client generation', function() {
    it('generates client from swagger spec url', async () => {
      const ds = await createDataSource(
        'http://petstore.swagger.io/v2/swagger.json',
      );

      ds.connector.should.have.property('client');
      ds.connector.client.should.have.property('apis');
    });

    it('generates client from local swagger spec - .json file', async () => {
      const ds = await createDataSource('test/fixtures/2.0/petstore.json');

      ds.connector.should.have.property('client');
      ds.connector.client.should.have.property('apis');
    });

    it('generates client from local swagger spec - .yaml file', async () => {
      const ds = await createDataSource('test/fixtures/2.0/petstore.yaml');

      ds.connector.should.have.property('client');
      ds.connector.client.should.have.property('apis');
    });

    it('generates client from swagger spec object', async () => {
      const ds = await createDataSource(require('./fixtures/2.0/petstore'));

      ds.connector.should.have.property('client');
      ds.connector.client.should.have.property('apis');
    });
  });

  describe('models', function() {
    describe('models without remotingEnabled', function() {
      let ds;
      before(async () => {
        ds = await createDataSource('test/fixtures/2.0/petstore.json');
      });

      it('creates models', () => {
        const PetService = ds.createModel('PetService', {});
        (typeof PetService.getPetById).should.eql('function');
        (typeof PetService.addPet).should.eql('function');
      });

      it('supports model methods with callback', done => {
        const PetService = ds.createModel('PetService', {});
        PetService.getPetById({petId: 1}, function(err, res) {
          if (err) return done(err);
          res.status.should.eql(200);
          done();
        });
      });

      it('supports model methods returning a Promise', async () => {
        const PetService = ds.createModel('PetService', {});
        const res = await PetService.getPetById({petId: 1});
        res.should.have.property('status', 200);
      });
    });

    it('allows models to be attached before the spec is loaded', async () => {
      const ds = await createDataSource('test/fixtures/2.0/petstore.json');
      const PetService = ds.createModel('PetService', {});

      should(Object.keys(PetService)).containEql('getPetById');
      should(typeof PetService.getPetById).eql('function');
    });
  });

  describe('Swagger invocations', function() {
    let ds, PetService;

    before(async () => {
      ds = await createDataSource('test/fixtures/2.0/petstore.json');
      PetService = ds.createModel('PetService', {});
    });

    it('invokes the PetService', async () => {
      const res = await PetService.getPetById({petId: 1});
      res.status.should.eql(200);
    });

    it('supports a request for xml content', async () => {
      const res = await PetService.getPetById(
        {petId: 1},
        {responseContentType: 'application/xml'},
      );

      res.status.should.eql(200);
      res.headers['content-type'].should.eql('application/xml');
    });

    it('invokes connector-hooks', done => {
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
      PetService.getPetById({petId: 1}, function(err, response) {
        assert.deepEqual(events, ['before execute', 'after execute']);
        done();
      });
    });

    it('supports Promise-based connector-hooks', done => {
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

      PetService.getPetById({petId: 1}, function(err, response) {
        assert.deepEqual(events, ['before execute', 'after execute']);
        done();
      });
    });
  });
});

async function createDataSource(spec, options) {
  const config = Object.assign(
    {
      connector: require('../index'),
      spec: spec,
    },
    options,
  );
  const ds = loopback.createDataSource('swagger', config);
  await pEvent(ds, 'connected');
  return ds;
}
