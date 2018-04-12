const pify = require('pify');
const nodePath = require('path');
const fs = require('fs');
const shortstop = require('shortstop');
const jsonminify = require('jsonminify');
const resolveFrom = require('resolve-from');
const shortstopHandlers = require('shortstop-handlers');

const readFileAsync = pify(fs.readFile);
const base64ProtocolAsync = pify(shortstopHandlers.base64());
const envProtocolAsync = pify(shortstopHandlers.env());

var commandLineNodeConfig;
var envNodeConfig;

function startsWith (str, prefix) {
  return str.length >= prefix.length && str.substring(0, prefix.length) === prefix;
}

/**
 * Do a deep merge of two objects. Only non-Array objects are merged. Arrays are *not* merged.
 */
function merge (src, dest) {
  if (src != null &&
        dest != null &&
        !Array.isArray(src) &&
        !Array.isArray(dest) &&
        typeof src === 'object' &&
        typeof dest === 'object') {
    Object.getOwnPropertyNames(src)
            .forEach(function (prop) {
              var descriptor = Object.getOwnPropertyDescriptor(src, prop);
              descriptor.value = merge(descriptor.value, dest[prop]);
              Object.defineProperty(dest, prop, descriptor);
            });

    return dest;
  }

  return src;
}

function parseJSON (json, errorMessage) {
  try {
    return JSON.parse(jsonminify(json));
  } catch (e) {
    throw new Error(errorMessage + '. Error: ' + e);
  }
}

/**
 * Build the NODE_CONFIG object by merging the NODE_CONFIG environment variable
 * and the --NODE_CONFIG command line argument.
 */
function getCommandLineNodeConfig () {
  if (commandLineNodeConfig === undefined) {
    var argv = process.argv.slice(2, process.argv.length);
    for (var i = 0; i < argv.length; i++) {
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

function getEnvNodeConfig () {
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
function getEnvironment (options) {
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
function buildSources (path, options) {
  var excludes = options.excludes;
  var sources = [];

  if (options.defaults) {
    sources = options.defaults.concat(sources);
  }

  var environment = getEnvironment(options);

  var basename = nodePath.basename(path);
  var ext = nodePath.extname(basename);

  var pathNoExt = path.slice(0, 0 - ext.length);

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

async function loadFileSource (path, options) {
  try {
    const json = await readFileAsync(path, {encoding: 'utf8'});
    const config = parseJSON(json, 'Failed to load config at path "' + path + '". Unable to parse JSON');
    return handleProtocols(config, path, options);
  } catch (err) {
        // Ignore missing files
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Asynchronously load all of the configuration objects from the various sources.
 */
async function loadSources (sources, options) {
  const mergedConfig = {};

  function handleSourceLoad (sourceConfig) {
    if (sourceConfig) merge(sourceConfig, mergedConfig);
  }

  for (const source of sources) {
    let sourceConfig;

    if (source == null) {
            // No-op... skip this source
      continue;
    } else if (typeof source === 'string') {
            // Load a source from a JSON file
      sourceConfig = await loadFileSource(source, options);
    } else if (Array.isArray(source)) {
      sourceConfig = await loadSources(source, options); // Load and merge all of the sources
    } else if (typeof source === 'function') {
      sourceConfig = await source(); // Invoke the function to asynchronously load the config object for this source
    } else if (typeof source === 'object') {
      sourceConfig = source; // Just merge the object
    } else {
      throw new Error('Invalid configuration source: ' + source);
    }

    handleSourceLoad(sourceConfig);
  }

  return mergedConfig;
}

function createRequireResolver (dirname) {
  return function requireResolver (target) {
    var modulePath = resolveFrom(dirname, target);
    return require(modulePath);
  };
}

function handleProtocols (config, path, options) {
  return new Promise((resolve, reject) => {
    var resolver = shortstop.create();

    var protocols = options.protocols;
    var hasProtocol = false;
    if (protocols) {
      Object.keys(protocols).forEach(function (protocol) {
        var handler = protocols[protocol];
        if (handler) {
          hasProtocol = true;
          resolver.use(protocol, async (value, callback) => {
            const retVal = handler(value);

            if (typeof retVal === 'object' && retVal.then) {
              retVal.then((promiseVal) => callback(null, promiseVal))
                              .catch(callback);
            } else {
              callback(null, retVal);
            }
          });
        }
      });
    }

    if (hasProtocol) {
      resolver.resolve(config, (err, res) => {
        return err ? reject(err) : resolve(res);
      });
    } else {
      resolve(config);
    }
  });
}

function addHelpers (config, options) {
  if (options.helpersEnabled === false) {
    return config;
  }

  function get (path) {
    var curObject = config;
    var parts = path.split('.');
    var i = 0;
    var len = parts.length;

    while (curObject && i < len) {
      var propName = parts[i];
      curObject = curObject[propName];
      i++;
    }

    return curObject;
  }

  Object.defineProperty(config, 'get', {
    enumerable: false,
    configurable: true,
    writable: true,
    value: get
  });

  return config;
}

async function load (path, options) {
  if (options) {
        // Create a copy of the options since we will be modifying the options
    Object.assign({}, options);
  } else {
    options = {};
  }

  let dir = nodePath.dirname(path);

  const fileProtocolAsync = pify(shortstopHandlers.file(dir));
  const execProtocolHandler = pify(shortstopHandlers.exec(dir));

    // Build a default set of protocols
  var protocols = {
    'path': function (value) {
      return nodePath.resolve(dir, value);
    },
    'import': function (value) {
      var importPath = nodePath.resolve(dir, value);
      var importOptions = Object.assign({}, options);

            // Keep the environment and protocols, but don't keep the sources
      delete importOptions.sources;
      delete importOptions.defaults;
      delete importOptions.overrides;
      delete importOptions.finalize;

      importOptions.excludes = Object.assign({}, options.excludes);

            // Exclude the environment variables
      importOptions.excludes['env'] = true;
      importOptions.excludes['command-line'] = true;

      importOptions.helpersEnabled = false; // Don't add helpers to imported configs

      return load(importPath, importOptions);
    },
    'file': fileProtocolAsync,
    'base64': base64ProtocolAsync,
    'env': envProtocolAsync,
    'require': createRequireResolver(dir),
    'exec': execProtocolHandler
  };

  if (options.protocols) {
        // If the user provided any protocols then those will override the defaults
    Object.assign(protocols, options.protocols);
  }

    // Store the protocols back in the options
  options.protocols = protocols;

  var excludes = null;

  if (options.excludes) {
    if (Array.isArray(options.excludes)) {
            // If the excludes are an array then convert them to a map
            // for easy lookup
      options.excludes.forEach(function (exclude) {
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

  const sources = buildSources(path, options);
  let finalConfig = await loadSources(sources, options);

  if (options.finalize) {
    const config = await options.finalize(finalConfig);

    if (config) {
            // If the finalize function provided a config object then use that
      finalConfig = config;
    }
  }

  return addHelpers(finalConfig, options);
}

exports.load = load;
