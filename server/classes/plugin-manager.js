const mongoose = require('mongoose');
const Promise = require('bluebird');
const debug = require('debug')('sawmon:plugin-manager');
const npmi = Promise.promisify(require('npmi'));

let pluginSchema = mongoose.Schema({
    name: {
        type: String,
        unique: true
    },
    version: String
});

var Plugin = mongoose.model('Plugin', pluginSchema);


/**
 * @name PluginCategory
 * @type {Object}
 * @property {Function} ping
 */

/**
 * @name Plugin
 * @type {Object}
 * @property {PluginCategory} websites
 * @property {PluginCategory} servers
 */

class PluginManager{
    /**
     * This should only be called once.
     * @returns {Promise}
     */
    initialize(){

        debug('Initializing PluginManager');
        /**
         * Holds the internal array of plugins.
         * @type {Array.<Plugin>}
         * @private
         */
        this._plugins = [
            {
                require: require('../../plugins/core'),
                database: {name: 'core', version: '0.0.0'}
            }
        ];

        debug('Finding plugins saved in database');
        return Plugin.find().then(plugins => {

            debug('Installing all saved plugins');
            return Promise.map(plugins, plugin => this.addPlugin(plugin));
        });
    }

    /**
     * Installs a plugin, and adds it to the database on success
     */
    addPlugin(plugin){
        if(plugin.name.charAt(0) == '.'){
            plugin.localInstall = true;
        }
        debug('Installing plugin %s', plugin.name);
        return npmi(plugin).then(() => {
            const nameToRequire = (plugin.localInstall ? '../../' : '') + plugin.name;
            let pluginInstance = {
                require: require(nameToRequire),
                database: plugin
            };

            /**
             * Add plugin to internal array
             */
            this._plugins.push(pluginInstance);

            debug('Installed %s', plugin.name);

            /**
             * Check if already in database
             */
            if(!plugin._id){
                /**
                 * Get package.json and save in database
                 */
                var modulePackage = require(nameToRequire + '/package.json');
                var dbPlugin = new Plugin({
                    name: plugin.name,
                    version: modulePackage.version
                });
                pluginInstance.database = dbPlugin;
                return dbPlugin.save().then(() => {
                    debug('Saved %s', plugin.name);
                });
            }
        }).catch(err => {
            console.error('Failed installing plugin', err);
        });
    }

    removePlugin(pluginId){
        return Plugin.findOne({_id: pluginId}).exec().then(plugin => {
            // Remove from database
            plugin.remove();

            // Require module
            const nameToRequire = (plugin.localInstall ? '../../' : '') + plugin.name;
            const PluginInstance = require(nameToRequire);

            // Delete from _plugins array
            const index = this._plugins.indexOf(PluginInstance);
            if(index > -1){
                this._plugins.splice(index, 1);
            }
        });
    }

    /**
     * Gets an array of plugins, given a category
     * @param {string} category
     * @param {boolean} onlyReturnCategory
     * @returns PluginCategory
     */
    getPlugins(category, onlyReturnCategory = true){
        let plugins = this._plugins;
        if(!plugins) return [];

        plugins = plugins.sort((a, b) => {
            if (a.require.dependencies && a.require.dependencies.indexOf(b.database.name) != -1) { // a has a dependency on b
                return -1;
            }
            if (b.require.dependencies && b.require.dependencies.indexOf(a.database.name) != -1) { // b has a dependency on a
                return 1;
            }

            // no dependencies defined
            return 0;
        });

        /**
         * Filter on category
         */
        if(category) {
            plugins = plugins.filter(plugin => {
                return typeof plugin.require[category] == 'object';
            });
        }

        /**
         * Only return the category itself
         */
        if(onlyReturnCategory){
            plugins = plugins.map(plugin => plugin.require[category]);
        }

        return plugins;
    }

    /**
     * Returns a promise of all plugin promises.
     * @param {string} category
     * @param {string} func
     * @param {object} passTrough
     * @returns Promise
     */
    getPromise(category, func, passTrough){
        let promises = {};

        this
            /**
             * Get all plugins of this category
             */
            .getPlugins(category, false)
            /**
             * That have the specified function
             */
            .filter(plugin => {
                return typeof plugin.require[category][func] == 'function';
            })
            .forEach(plugin => {
                /**
                 * Get all the dependencies as promises
                 */
                let dependencies = plugin.require.dependencies ? plugin.require.dependencies.map(dependency => promises[dependency]) : [];

                /**
                 * Execute this after all dependencies
                 */
                promises[plugin.database.name] = Promise.all(dependencies).then(() => plugin.require[category][func](passTrough));
            });


        /**
         * Resolve all promises
         */
        return Promise
            .all(Object.keys(promises).map(key => promises[key]))
            .catch(err => console.error(
                'A plugin did\'n t catch all problems. Please report this to the plugin module author.', err
            ));
    }

    /**
     * Get all installed plugins, as defined in the database
     * @returns {Promise.<Array.<Object>>}
     */
    getInstalledPlugins(){
        return Plugin.find();
    }
}

module.exports = new PluginManager();