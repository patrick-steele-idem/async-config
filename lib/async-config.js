var nodePath = require('path');
var async = require('async');
var fs = require('fs');
var DataHolder = require('raptor-async/DataHolder');
var extend = require('raptor-util/extend');
var shortstop = require('shortstop');
var jsonminify = require('jsonminify');
var resolveFrom = require('resolve-from');
var shortstopHandlers = require('shortstop-handlers');

var commandLineNodeConfig;
var envNodeConfig;

function startsWith(str, prefix) {
    return str.length >= prefix.length && str.substring(0, prefix.length) === prefix;
}

/**
 * Do a deep merge of two objects. Only non-Array objects are merged. Arrays are *not* merged.
 */
function merge(src, dest) {
    if (src != null &&
        dest != null &&
        !Array.isArray(src) &&
        !Array.isArray(dest) &&
        typeof src === 'object' &&
        typeof dest === 'object') {

        Object.getOwnPropertyNames(src)
            .forEach(function(prop) {
                var descriptor = Object.getOwnPropertyDescriptor(src, prop);
                descriptor.value = merge(descriptor.value, dest[prop]);
                Object.defineProperty(dest, prop, descriptor);
            });

        return dest;
    }

    return src;
}

function parseJSON(json, errorMessage) {
    try {
        return JSON.parse(jsonminify(json));
    } catch(e) {
        throw new Error(errorMessage + '. Error: ' + e);
    }
}

/**
 * Build the NODE_CONFIG object by merging the NODE_CONFIG environment variable
 * and the --NODE_CONFIG command line argument.
 */
function getCommandLineNodeConfig() {
    if (commandLineNodeConfig === undefined) {
        var argv = process.argv.slice(2, process.argv.length);
        for (var i=0; i<argv.length; i++) {
            if (startsWith(argv[i], '--NODE_CONFIG=')) {
                commandLineNodeConfig = parseJSON(argv[i].substring('--NODE_CONFIG='.length), 'Unable to parse the JSON from the "--NODE_CONFIG" command line argument');
                break;
            }
        }

        if (commandLineNodeConfig === undefined) {
            commandLineNodeConfig = null;
        }
    }

    return commandLineNodeConfig;
}

function getEnvNodeConfig() {
    if (envNodeConfig === undefined) {
        if (process.env.NODE_CONFIG) {
            envNodeConfig = parseJSON(process.env.NODE_CONFIG, 'Unable to parse the JSON from the "NODE_CONFIG" environment variable');
        } else {
            envNodeConfig = null;
        }
    }

    return envNodeConfig;
}

/**
 * Determine the environment from the provided options and the
 * NODE_ENV environment variable. Also normalize the environment
 * name such that "prod" becomes "production" and "dev" becomes
 * "development".
 */
function getEnvironment(options) {
    var env;

    if (options.environment) {
        env = options.environment;
    } else {
        env = process.env.NODE_ENV;
    }

    if (env) {
        if (env === 'prod') {
            env = 'production';
        } else if (env === 'dev') {
            env = 'development';
        }
    } else {
        // Default to "development"
        env = 'development';
    }

    return env;
}

/**
 * Given a path, generate an array of sources to be merged
 * together in the correct order. A source can be any of the following:
 * - A String path to a JSON file
 * - A Function that asychronously provides a configuration object to merge
 * - A configuration object
 */
function buildSources(path, options) {
    var excludes = options.excludes;
    var sources = [];

    if (options.defaults) {
        sources = options.defaults.concat(sources);
    }

    var environment = getEnvironment(options);

    var basename = nodePath.basename(path);
    var ext = nodePath.extname(basename);

    var pathNoExt = path.slice(0, 0-ext.length);

    if (!ext) {
        ext = '.json';
    }

    sources.push(pathNoExt + ext);

    if (excludes['env-file'] !== true) {
        sources.push(pathNoExt + '-' + environment + ext);
    }

    if (excludes['local-file'] !== true) {
        sources.push(pathNoExt + '-local' + ext);
    }

    if (excludes['env'] !== true) {
        sources.push(getEnvNodeConfig());
    }

    if (excludes['command-line'] !== true) {
        sources.push(getCommandLineNodeConfig());
    }

    if (options.overrides) {
        sources = sources.concat(options.overrides);
    }

    if (typeof options.sources === 'function') {
        var newSources = options.sources(sources);
        if (newSources != null) {
            sources = newSources;
        }
    }

    return sources;
}

function loadFileSource(path, callback) {
    fs.readFile(path, {encoding: 'utf8'}, function(err, json) {
        if (err) {
            if (err.code === 'ENOENT') {
                // Ignore missing files
                return callback();
            }
            return callback(err);
        }

        callback(null, parseJSON(json, 'Failed to load config at path "' + path + '". Unable to parse JSON'));
    });
}

/**
 * Asynchronously load all of the configuration objects from the various sources.
 */
function loadSources(sources, callback) {

    var mergedConfig = {};

    var tasks = sources.map(function(source, i) {
        return function (callback) {

            function handleSourceLoad(err, sourceConfig) {
                if (err) {
                    return callback(err);
                }

                if (sourceConfig) {
                    merge(sourceConfig, mergedConfig);
                }

                callback();
            }

            if (source == null) {
                callback(); // No-op... skip this source
            } else if (typeof source === 'string') {
                loadFileSource(source, handleSourceLoad); // Load a source from a JSON file
            } else if (Array.isArray(source)) {
                loadSources(source, handleSourceLoad); // Load and merge all of the sources
            } else if (typeof source === 'function') {
                source(handleSourceLoad); // Invoke the function to asynchronously load the config object for this source
            } else if (typeof source === 'object') {
                handleSourceLoad(null, source); // Just merge the object
            } else {
                callback(new Error('Invalid configuration source: ' + source));
            }
        };
    });

    async.series(tasks, function (err) {
        if (err) {
            return callback(err);
        }

        callback(null, mergedConfig);
    });
}

function createRequireResolver(dirname) {
    return function requireResolver(target) {
        var modulePath = resolveFrom(dirname, target);
        return require(modulePath);
    };
}

function handleProtocols(config, path, options, callback) {
    var resolver = shortstop.create();

    var protocols = options.protocols;
    var hasProtocol = false;
    if (protocols) {
        Object.keys(protocols).forEach(function(protocol) {
            var handler = protocols[protocol];
            if (handler) {
                hasProtocol = true;
                resolver.use(protocol, handler);
            }
        });
    }

    if (hasProtocol) {
        resolver.resolve(config, callback);
    } else {
        callback(null, config);
    }
}

function addHelpers(config, options) {
    if (options.helpersEnabled === false) {
        return config;
    }

    function get(path) {
        var curObject = config;
        var parts = path.split('.');
        var i=0;
        var len = parts.length;

        while (curObject && i<len) {
            var propName = parts[i];
            curObject = curObject[propName];
            i++;
        }

        return curObject;
    }

    Object.defineProperty(config, "get", {
        enumerable: false,
        configurable: true,
        writable: true,
        value: get
    });

    return config;
}

function load(path, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    if (options) {
        // Create a copy of the options since we will be modifying the options
        extend({}, options);
    } else {
        options = {};
    }

    var dir = nodePath.dirname(path);

    // Build a default set of protocols
    var protocols = {
        'path':  function(value) {
            return nodePath.resolve(dir, value);
        },
        'import': function(value, callback) {
            var importPath = nodePath.resolve(dir, value);
            var importOptions = extend({}, options);

            // Keep the environment and protocols, but don't keep the sources
            delete importOptions.sources;
            delete importOptions.defaults;
            delete importOptions.overrides;
            delete importOptions.finalize;

            importOptions.excludes = extend({}, options.excludes);

            // Exclude the environment variables
            importOptions.excludes['env'] = true;
            importOptions.excludes['command-line'] = true;

            importOptions.helpersEnabled = false; // Don't add helpers to imported configs

            load(importPath, importOptions, callback);
        },
        'file':   shortstopHandlers.file(dir),
        'base64': shortstopHandlers.base64(),
        'env': shortstopHandlers.env(),
        'require': createRequireResolver(dir),
        'exec': shortstopHandlers.exec(dir)
    };

    if (options.protocols) {
        // If the user provided any protocols then those will override the defaults
        extend(protocols, options.protocols);
    }

    // Store the protocols back in the options
    options.protocols = protocols;

    var excludes = null;

    if (options.excludes) {
        if (Array.isArray(options.excludes)) {
            // If the excludes are an array then convert them to a map
            // for easy lookup
            options.excludes.forEach(function(exclude) {
                excludes[exclude] = true;
            });
        } else {
            excludes = options.excludes;
        }
    } else {
        excludes = {};
    }

    // Store the excludes back into the options
    options.excludes = excludes;

    var dataHolder = new DataHolder();

    if (callback) {
        dataHolder.done(callback);
    }

    var sources = buildSources(path, options);
    loadSources(sources, function(err, config) {
        if (err) {
            return dataHolder.reject(err);
        }

        handleProtocols(config, path, options, function(err, finalConfig) {
            if (err) {
                return dataHolder.reject(err);
            }

            if (options.finalize) {
                options.finalize(finalConfig, function(err, config) {
                    if (err) {
                        return dataHolder.reject(err);
                    }

                    if (config) {
                        // If the finalize function provided a config object then use that
                        finalConfig = config;
                    }

                    dataHolder.resolve(addHelpers(finalConfig, options));
                });
            } else {
                dataHolder.resolve(addHelpers(finalConfig, options));
            }

        });
    });

    return {
        done: function(callback) {
            dataHolder.done(callback);
        }
    };
}

exports.load = load;