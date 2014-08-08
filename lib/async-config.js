var nodePath = require('path');
var async = require('async');
var fs = require('fs');
var DataHolder = require('raptor-async/DataHolder');
var extend = require('raptor-util/extend');
var shortstop = require('shortstop');
var jsonminify = require('jsonminify');
var resolveFrom = require('resolve-from');
var shortstopHandlers = require('shortstop-handlers');

var NODE_CONFIG = null;

function startsWith(str, prefix) {
    return str.length >= prefix.length && str.substring(0, prefix.length) === prefix;
}

function merge(src, dest) {
    // NOTE: Do not merge arrays and only merge objects into objects.
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

function getNodeConfig() {
    if (!NODE_CONFIG) {
        var argv = process.argv.slice(2, process.argv.length);
        for (var i=0; i<argv.length; i++) {
            if (startsWith(argv[i], '--NODE_CONFIG=')) {
                NODE_CONFIG = JSON.parse(argv[i].substring('--NODE_CONFIG='.length));
                break;
            }
        }

        if (!NODE_CONFIG) {
            NODE_CONFIG = {};
        }

        if (process.env.NODE_CONFIG) {
            merge(process.env.NODE_CONFIG, NODE_CONFIG);
        }
    }

    return NODE_CONFIG;
}


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
        env = 'development';
    }

    return env;
}
function buildSources(path, options) {
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
    sources.push(pathNoExt + '-' + environment + ext);
    sources.push(pathNoExt + '-local' + ext);
    sources.push(getNodeConfig());

    if (options.overrides) {
        sources = sources.concat(options.overrides);
    }

    if (typeof options.sources === 'function') {
        var newSources = options.sources(options.sources);
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

        var o;

        try {
            o = JSON.parse(jsonminify(json));
        } catch(e) {
            callback(new Error('Failed to load config at path "' + path + '". Unable to parse JSON. Error: ' + e));
        }

        callback(null, o);
    });
}

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
                handleSourceLoad();
            } else if (typeof source === 'string') {
                loadFileSource(source, handleSourceLoad);
            } else if (Array.isArray(source)) {
                loadSources(source, handleSourceLoad);
            } else if (typeof source === 'function') {
                source(handleSourceLoad);
            } else if (typeof source === 'object') {
                handleSourceLoad(null, source);
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

            function get(path) {
                var curObject = finalConfig;
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

            finalConfig.get = get;

            dataHolder.resolve(finalConfig);
        });
    });

    return {
        done: function(callback) {
            dataHolder.done(callback);
        }
    };
}

exports.load = load;