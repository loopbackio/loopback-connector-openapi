// Copyright IBM Corp. 2019. All Rights Reserved.
// Node module: loopback-connector-openapi
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const assert = require('assert');
const should = require('should');
const loopback = require('loopback');
const pEvent = require('p-event');
const http = require('http');
const https = require('https');

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
    let ds, PetService, petId;
    before('connect to pet store', async () => {
      ds = await createDataSource('test/fixtures/2.0/petstore.json');
      PetService = ds.createModel('PetService', {});
      const data = await PetService.findPetsByStatus({status: 'available'});
      should(data.body).be.Array();
      should(data.body.length).be.above(0);
      petId = data.body[data.body.length - 1].id;
    });

    it('creates models', () => {
      (typeof PetService.getPetById).should.eql('function');
      (typeof PetService.addPet).should.eql('function');
    });

    it('supports model methods with callback', (done) => {
      PetService.getPetById({petId}, function(err, res) {
        if (err) return done(err);
        res.status.should.eql(200);
        done();
      });
    });

    it('supports model methods returning a Promise', async () => {
      const res = await PetService.getPetById({petId});
      res.should.have.property('status', 200);
    });

    it('allows models to be attached before the spec is loaded', async () => {
      const ds = await createDataSource('test/fixtures/2.0/petstore.json');
      const PetService = ds.createModel('PetService', {});

      should(Object.keys(PetService)).containEql('getPetById');
      should(typeof PetService.getPetById).eql('function');
    });
  });

  describe('Swagger invocations', function() {
    let ds, PetService, petId;

    before('connect to pet store', async () => {
      ds = await createDataSource('test/fixtures/2.0/petstore.json');
      PetService = ds.createModel('PetService', {});

      // https://petstore.swagger.io/v2/pet/findByStatus?status=available
      const data = await PetService.findPetsByStatus({status: 'available'});
      should(data.body).be.Array();
      should(data.body.length).be.above(0);
      petId = data.body[data.body.length - 1].id;
    });

    it('invokes the PetService', async () => {
      const res = await PetService.getPetById({petId});
      res.status.should.eql(200);
    });

    it('supports a request for xml content', async () => {
      const res = await PetService.getPetById(
        {petId},
        {responseContentType: 'application/xml'},
      );

      res.status.should.eql(200);
      res.headers['content-type'].should.eql('application/xml');
    });

    it('invokes connector-hooks', (done) => {
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
      PetService.getPetById({petId}, function(err, response) {
        assert.deepEqual(events, ['before execute', 'after execute']);
        done();
      });
    });

    it('supports Promise-based connector-hooks', (done) => {
      const events = [];
      const connector = ds.connector;

      connector.observe('before execute', (ctx) => {
        events.push('before execute');
        return Promise.resolve();
      });

      connector.observe('after execute', (ctx) => {
        events.push('after execute');
        return Promise.resolve();
      });

      PetService.getPetById({petId}, function(err, response) {
        assert.deepEqual(events, ['before execute', 'after execute']);
        done();
      });
    });
  });
});

describe('options for openapi connector', () => {
  let ds, PetService;

  before(async () => {
    ds = await createDataSource('test/fixtures/2.0/petstore.yaml', {
      forceOpenApi30: true,
      transformResponse: true,
      positional: true,
      httpClientOptions: {
        agent: (url) => {
          return url.protocol === 'http:' ?
            new http.Agent({timeout: 3000}) :
            new https.Agent({rejectUnauthorized: false});
        },
      },
    });
    PetService = ds.createModel('PetService', {});
  });

  // The PetStore service now disables `addPet` with 405
  it.skip('supports forceOpenApi30', async () => {
    const pet = await PetService.addPet({
      category: {id: 0},
      name: 'dog9375',
      photoUrls: [],
      tags: [],
      status: 'available',
    });
    assert(pet.id);
  });

  it('supports positional & transformResponse', async () => {
    // https://petstore.swagger.io/v2/pet/findByStatus?status=available
    const data = await PetService.findPetsByStatus('available');
    assert(data.length > 0);
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
