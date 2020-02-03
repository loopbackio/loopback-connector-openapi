// Copyright IBM Corp. 2016,2019. All Rights Reserved.
// Node module: loopback-connector-openapi
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

/* eslint-disable max-len */

const should = require('should');
const SpecResolver = require('../lib/spec-resolver');

describe('OpenAPI Spec SpecResolver', () => {
  let specResolver;
  beforeEach(() => {
    specResolver = new SpecResolver();
  });

  it('Should set url when given spec is a url', async () => {
    const spec = 'http://sample.com/swaggerAPI.json';
    specResolver.resolve(spec).should.be.rejectedWith('');
  });

  it('Should set spec object when given spec is swagger specification object', function(done) {
    const spec = require('./fixtures/2.0/petstore');
    specResolver.resolve(spec, function(err, api) {
      if (err) return done(err);
      api.should.have.property('swagger');
      done();
    });
  });

  it('Should not accept specification types other than string/plain object', function(done) {
    const spec = function test() {};
    specResolver.resolve(spec, function(err, api) {
      should.exist(err);
      done();
    });
  });

  describe('File handling & spec resolution', function() {
    it('should read & set swagger spec from a local .json file', function(done) {
      const spec = './test/fixtures/2.0/petstore.json';
      specResolver.resolve(spec, function(err, api) {
        if (err) return done(err);
        api.should.have.property('swagger');
        done();
      });
    });

    it('should read & set swagger spec from a local .yaml file', function(done) {
      const spec = './test/fixtures/2.0/petstore.yaml';
      specResolver.resolve(spec, function(err, api) {
        if (err) return done(err);
        api.should.have.property('swagger');
        done();
      });
    });

    it('should support .yml extension for YAML spec files', function(done) {
      const spec = './test/fixtures/2.0/petstore.yml';
      specResolver.resolve(spec, function(err, api) {
        if (err) return done(err);
        api.should.have.property('swagger');
        done();
      });
    });

    it('should not accept other spec file formats than .json/.yaml', function(done) {
      const spec = './test/fixtures/2.0/petstore.yaaml';
      specResolver.resolve(spec, function(err, api) {
        should.exist(err);
        done();
      });
    });
  });

  describe('Spec validation against Swagger schema 2.0', function() {
    it('should validate provided specification against swagger spec. 2.0', function(done) {
      const spec = './test/fixtures/2.0/petstore.yaml';
      specResolver.resolve(spec, function(err, api) {
        if (err) return done(err);
        specResolver.validate(api, done);
      });
    });

    it('should throw error if validation fails', function(done) {
      const spec = {this: 'that'};

      specResolver.validate(spec, function(err, api) {
        should.exist(err);
        done();
      });
    });
  });

  describe('OpenAPI 3.0', function() {
    it('loads OpenAPI spec 3.0 yaml', function(done) {
      const spec = './test/fixtures/3.0/petstore.yaml';
      specResolver.resolve(spec, function(err, api) {
        if (err) return done(err);
        api.should.have.property('openapi', '3.0.0');
        done();
      });
    });
  });
});
