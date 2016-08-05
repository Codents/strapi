'use strict';

/**
 * Module dependencies
 */

// Public node modules.
const _ = require('lodash');
const mongoose = require('mongoose');
const mongooseUtils = require('mongoose/lib/utils');
const pluralize = require('pluralize');

// Local helpers.
const utils = require('./utils/');

// Strapi helpers for models.
const utilsModels = require('strapi/lib/configuration/hooks/models/utils/');

/**
 * Bookshelf hook
 */

module.exports = function (strapi) {
  const hook = {

    /**
     * Default options
     */

    defaults: {
      defaultConnection: 'default'
    },

    /**
     * Initialize the hook
     */

    initialize: function (cb) {
      let globalName;

      // Return callback if there is no model
      if (_.isEmpty(strapi.models)) {
        return cb();
      }

      // Connect to mongo database
      mongoose.connect('mongodb://localhost/test');

      const db = mongoose.connection;

      // Handle error
      db.on('error', error => {
        cb(error);
      });

      // Handle success
      db.on('open', () => {
        // Initialize collections
        _.set(strapi, 'mongoose.collections', {});

        const loadedAttributes = _.after(_.size(strapi.models), function () {
          console.log(strapi.mongoose.collections);
          _.forEach(strapi.models, function (definition, model) {
            try {
              // Initialize lifecycle callbacks.
              // loadedModel.initialize = function () {
              //   const self = this;
              //   const lifecycle = {
              //     creating: 'beforeCreate',
              //     created: 'afterCreate',
              //     destroying: 'beforeDestroy',
              //     destroyed: 'afterDestroy',
              //     updating: 'beforeUpdate',
              //     updated: 'afterUpdate',
              //     fetching: 'beforeFetch',
              //     fetched: 'afterFetch',
              //     saving: 'beforeSave',
              //     saved: 'afterSave'
              //   };
              //
              //   _.forEach(lifecycle, function (fn, key) {
              //     if (_.isFunction(strapi.models[model.toLowerCase()][fn])) {
              //       self.on(key, strapi.models[model.toLowerCase()][fn]);
              //     }
              //   });
              // };
              console.log(model);

              console.log("NO VIRTUAL", _.omitBy(definition.loadedModel, model => {
                return model.type === 'virtual';
              }));

              console.log("VIRTUAL", _.pickBy(definition.loadedModel, model => {
                return model.type === 'virtual';
              }));

              // Add virtual key to provide populate and reverse populate
              _.forEach(_.pickBy(definition.loadedModel, model => {
                return model.type === 'virtual'
              }), (value, key) => {
                strapi.mongoose.collections[mongooseUtils.toCollectionName(definition.globalName)].schema.virtual(key.replace('_v', ''), {
                  ref: value.ref,
                  localField: '_id',
                  foreignField: value.via,
                  justOne: value.justOne || false
                });
              });

              console.log('------------------');

              strapi.mongoose.collections[mongooseUtils.toCollectionName(definition.globalName)].schema.set('toObject', {
                virtuals: true
              });

              strapi.mongoose.collections[mongooseUtils.toCollectionName(definition.globalName)].schema.set('toJSON', {
                virtuals: true
              });

              global[definition.globalName] = mongoose.model(definition.globalName, strapi.mongoose.collections[mongooseUtils.toCollectionName(definition.globalName)].schema);

              // Push model to strapi global variables.
              strapi.mongoose.collections[mongooseUtils.toCollectionName(definition.globalName)] = global[definition.globalName];

              // Push attributes to be aware of model schema.
              strapi.mongoose.collections[mongooseUtils.toCollectionName(definition.globalName)]._attributes = definition.attributes;
            } catch (err) {
              strapi.log.error('Impossible to register the `' + model + '` model.');
              strapi.log.error(err);
              strapi.stop();
            }
          });

          cb();
        });

        // Parse every registered model.
        _.forEach(strapi.models, function (definition, model) {
          definition.globalName = _.capitalize(definition.globalId);

          // Make sure the model has a table name.
          // If not, use the model name.
          if (_.isEmpty(definition.collectionName)) {
            definition.collectionName = model;
          }

          // Make sure the model has a connection.
          // If not, use the default connection.
          if (_.isEmpty(definition.connection)) {
            definition.connection = strapi.config.defaultConnection;
          }

          // Make sure this connection exists.
          if (!_.has(strapi.config.connections, definition.connection)) {
            strapi.log.error('The connection `' + definition.connection + '` specified in the `' + model + '` model does not exist.');
            strapi.stop();
          }

          // Add some informations about ORM & client connection
          definition.orm = 'mongoose';
          definition.client = _.get(strapi.config.connections[definition.connection], 'client');

          // Register the final model for Bookshelf.
          definition.loadedModel = _.cloneDeep(definition.attributes);

          // Initialize the global variable with the
          // capitalized model name.
          global[definition.globalName] = {};

          if (_.isEmpty(definition.attributes)) {
            return loadedAttributes();
          }

          // Call this callback function after we are done parsing
          // all attributes for relationships-- see below.
          const done = _.after(_.size(definition.attributes), function () {
            // Generate schema without virtual populate
            _.set(strapi.mongoose.collections, mongooseUtils.toCollectionName(definition.globalName) + '.schema', mongoose.Schema(_.omitBy(definition.loadedModel, model => {
              return model.type === 'virtual';
            })));

            console.log('##################');
            loadedAttributes();
          });

          // Add every relationships to the loaded model for Bookshelf.
          // Basic attributes don't need this-- only relations.
          _.forEach(definition.attributes, function (details, name) {
            const verbose = _.get(utilsModels.getNature(details, name), 'verbose') || '';

            // Build associations key
            if (!_.isEmpty(verbose)) {
              utilsModels.defineAssociations(globalName, definition, details, name);
            } else {
              definition.loadedModel[name].type = utils(mongoose).convertType(details.type);
            }

            let FK;

            console.log(model, verbose)

            switch (verbose) {
              case 'hasOne':
                definition.loadedModel[name] = {
                  type: mongoose.Schema.Types.ObjectId,
                  ref: _.capitalize(details.model)
                };
                break;

              case 'hasMany':
                FK = _.find(definition.associations, { alias : name});

                if (FK) {
                  definition.loadedModel[name] = {
                    type: 'virtual',
                    ref: _.capitalize(details.collection),
                    via: FK.via
                  };
                } else {
                  definition.loadedModel[name] = [{
                    type: mongoose.Schema.Types.ObjectId,
                    ref: _.capitalize(details.collection)
                  }];
                }
                break;

              case 'belongsTo':
                FK = _.find(definition.associations, { alias : name});

                if (FK && FK.nature === 'oneToOne') {
                  definition.loadedModel[name] = {
                    type: 'virtual',
                    ref: _.capitalize(details.model),
                    via: FK.via,
                    justOne: true
                  };
                } else {
                  definition.loadedModel[name] = {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: _.capitalize(details.model)
                  };
                }
                break;

              case 'belongsToMany':
                FK = _.find(definition.associations, { alias : name});
                console.log(FK);
                if (FK) {
                  definition.loadedModel[name + '_v'] = {
                    type: 'virtual',
                    ref: _.capitalize(details.collection),
                    via: FK.via
                  };

                  definition.loadedModel[name] = [{
                    type: mongoose.Schema.Types.ObjectId,
                    ref: _.capitalize(details.collection)
                  }];
                }
                break;

              default:
                break;
            }

            done();
          });
        });
      });
    }
  };

  return hook;
};
