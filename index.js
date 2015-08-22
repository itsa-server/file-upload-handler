/**
 * Accepts and processes filechunks from a client and rebuilds a final file
 * once all chunks have arrived.
 *
 * The filechunks MUST follow specific rules, as specified by http://itsa.io/docs/io/index.html#io-filetransfer
 * Therefore, this module is best used together with the ITSA-framework (http://itsa.io)
 *
 * IMPORTANT NOTE: this module is build for usage with hapijs.
 *
 * <i>Copyright (c) 2015 ITSA - https://github.com/itsa-server/file-upload-handler</i>
 * New BSD License - http://choosealicense.com/licenses/bsd-3-clause/
 *
 * @module file-upload-handler
 * @class Fileuploadhandler
*/

"use strict";

var fs = require('fs'),
    fsp = require('fs-promise'),
    utils = require('utils'),
    idGenerator = utils.idGenerator,
    DEF_NS_CLIENT_ID = 'ITSA_CL_ID',
    DEF_MAX_FILESIZE = 10*1024*1024, // 10Mb
    TMP_FILE = 'tmp-file',
    REVIVER = function(key, value) {
        return ((typeof value==='string') && value.toDate()) || value;
    },
    getUniqueFilename, createDir, getFinalFile, removeFile, handleFile;

require('js-ext/js-ext.js'); // full version
require('fs-extra');
require('writestream-promise'); // extends fs.WriteStream with .endPromise

/**
 * Generates an unique filename in the specified folder.
 *
 * @method getUniqueFilename
 * @param folder {String} the folder where the filename should reside
 * @return {String} unique filename
 * @since 0.0.1
*/
getUniqueFilename = function(folder) {
    var tmpFilename = idGenerator(TMP_FILE)+'-'+Date.now(),
        nameReserved;
    nameReserved = function(filename, i) {
        var fullFilename = filename + (i>0 ? '-'+i : '');
        return fsp.exists(fullFilename).then(function(exists) {
            return exists ? nameReserved(filename, i+1) : fullFilename;
        });
    };
    return nameReserved(folder + tmpFilename, 0);
};

/**
 * Creates a folder (if it should not exists)
 *
 * @method createDir
 * @param folder {String} the folder where the filename should reside
 * @return {Promise} resolved when ready
 * @since 0.0.1
*/
createDir = function(folder) {
    return fsp.exists(folder).then(function(exists) {
        if (!exists) {
            return fsp.mkdirs(folder);
        }
    });
};

/**
 * Removes a file (if exists)
 *
 * @method removeFile
 * @param filename {String} the full absolute filename that should be removed
 * @return {Promise} resolved when ready
 * @since 0.0.1
*/
removeFile = function(filename) {
    return fsp.exists(filename).then(function(exists) {
        if (exists) {
            return fsp.unlink(filename);
        }
    });
};

/**
 * Builds an unique file, out of the separate chunks of the specified transmission.
 * Removes the intermediate chunks. The final file will be created in the directory specified with `folder`
 *
 * @method getFinalFile
 * @param folder {String} the folder where the file should be created
 * @param transmission {Object} the transmision-object that holds all chunk-definitions
 * @return {String} unique filename of the new created composed file
 * @since 0.0.1
*/
getFinalFile = function(folder, transmission) {
    return getUniqueFilename(folder).then(function(tmpBuildFilename) {
        var partCount = transmission.count,
            wstream = fs.createWriteStream(tmpBuildFilename),
            appendFileData;

        appendFileData = function(part) {
            return fsp.readFile(transmission[part]).then(function(data) {
                // TODO: wait for asynchronious finishing writing
                wstream.write(data);
                if (part===partCount) {
                    return wstream.endPromise().finally(function() {
                        // remove all temporarely files
                        transmission.each(function(filename, key) {
                            key.validateNumber() && removeFile(filename);
                        });
                    });
                }
                else {
                    return appendFileData(part+1);
                }
            });
        };

        return appendFileData(1).then(function() {
            return {
                originalFilename: transmission.filename,
                tmpBuildFilename: tmpBuildFilename
            };
        });
    });
};

/**
 * The modules.export-function, which returns an object with 2 properties: `generateClientId` and `recieveFile`,
 * which are both functions.
 *
 * `generateClientId` generates an unique clientId, which clients should use to identify themselves during fileuploads.
 *
 * `recieveFile` should be invoked for every filechunk that is send to the server.
 *
 * Both methods expect the client to follow specific rules, as specified by http://itsa.io/docs/io/index.html#io-filetransfer
 * Therefore, this module is best used together with the ITSA-framework (http://itsa.io)
 *
 * IMPORTANT NOTE: this method is build for usage with hapijs.
 *
 * @method handleFile
 * @param [tempdir] {String} the folder where the temporarely-file should be created. If not specified,
 *                           then nodejs its temp environment's variable will be used
 * @param [maxFileSize] {Number} the max upload filesize to be accepted. Can be overrules per route (when specifying `recieveFile`).
 *                               if not specified, then a value of 10Mb is used
 * @param [nsClientId] {String} the namespace that is used as prefix for every unique generated clientId (generated by `generateClientId`).
 *                              if not specified, then `ITSA_CL_ID` is used.
 * @return {Object} Object with the properties: `generateClientId` and `recieveFile`
 * @since 0.0.1
*/
handleFile = function(tempdir, maxFileSize, nsClientId) {
    var TMP_DIR = tempdir || process.env.TMP || process.env.TEMP || '/tmp',
        NS_CLIENT_ID = nsClientId || DEF_NS_CLIENT_ID,
        FILE_TRANSMISSIONS = {},
        globalMaxFileSize = maxFileSize,
        tmpDirCreated;

    TMP_DIR.endsWith('/') || (TMP_DIR=TMP_DIR+'/');

    tmpDirCreated = createDir(TMP_DIR);

    /**
     * Object that holds all transmission id's. The object gets a structure like this:
     *
     * {
     *      "ITSA_CL_ID-1": { // client number "1"
     *          "ITSA-FILETRANS-1": { // transmission number "1", for this client
     *              cummulatedSize: {Number}, // the total size of all recieved chinks of this transmission
     *              count: {Number}, // the total amont of chunks that are send for this file (only available when the last chunk-part is recieved)
     *              filename: {String}, // the client;s filename of the sent file (only available when the last chunk-part is recieved)
     *              data: {Object}, // additional params that are sent with the request (only available when the last chunk-part is recieved)
     *              '1': {String}, // the filename of the temporarely written 1st chunk
     *              '2': {String}, // the filename of the temporarely written 2nd chunk
     *              '3': {String}, // the filename of the temporarely written 3th chunk
     *              etc...
     *          },
     *          "ITSA-FILETRANS-2": { // transmission number "2", for this client
     *              cummulatedSize: {Number},
     *              count: {Number},
     *              filename: {String},
     *              data: {Object},
     *              '1': {String},
     *              '2': {String},
     *              '3': {String},
     *              etc...
     *          },
     *          etc...
     *      },
     *      "ITSA_CL_ID-2": { // client number "2"
     *          "ITSA-FILETRANS-1": { // transmission number "1", for this client
     *              cummulatedSize: {Number},
     *              count: {Number},
     *              filename: {String},
     *              data: {Object},
     *              '1': {String},
     *              '2': {String},
     *              '3': {String},
     *              etc...
     *          },
     *          etc...
     *      },
     *      etc...
     * }
     *
     * @property FILE_TRANSMISSIONS
     * @type Object
     * @default {}
     * @private
     * @since 0.0.1
     */

    return {
        /**
         * Generates an unique clientId, which clients should use to identify themselves during fileuploads.
         * Will invoke `reply` internally.
         *
         * This methods expects the client to follow specific rules, as specified by http://itsa.io/docs/io/index.html#io-filetransfer
         * Therefore, it is best used together with the ITSA-framework (http://itsa.io)
         *
         * IMPORTANT NOTE: this method is build for usage with hapijs.
         *
         * @method generateClientId
         * @for handleFile
         * @param request {Object} hapijs its request-object
         * @param reply {Object} hapijs its reply-object
         * @param [accessControlAllowOrigin] {String} the content of the `access-control-allow-origin`-response-header
         * @return serverresponse, with the unique clientId as text/html
         * @since 0.0.1
        */
        generateClientId: function(request, reply, accessControlAllowOrigin) {
            var replyInstance = reply(idGenerator(NS_CLIENT_ID));
            accessControlAllowOrigin && replyInstance.header('access-control-allow-origin', accessControlAllowOrigin);
        },

        /**
         * Recieves and processes filechunks from a client's fileupload.
         *
         * This methods expects the client to follow specific rules, as specified by http://itsa.io/docs/io/index.html#io-filetransfer
         * Therefore, it is best used together with the ITSA-framework (http://itsa.io)
         *
         * IMPORTANT NOTE: this method is build for usage with hapijs.
         *
         * @method recieveFile
         * @param request {Object} hapijs its request-object
         * @param reply {Object} hapijs its reply-object
         * @param [maxFileSize] {Number} the max upload filesize to be accepted. If not specified, then the global value
        *                                as set during `import` is being used.
         * @param [callback] {Function} the function that should be invoked once all chunks have been processed and the final temporarely
         *                              file has been created. The caalbackFn will be invoked with 2 arguments: `tmpBuildFilename` and `originalFilename`
         *                              `tmpBuildFilename` is the FULL path to the temporarely file
         *                              `originalFilename` is just a filename (without path), as selected on the client
         *                              AFTER the callback gets invoked, tmpBuildFilename will be removed automaticly. Therefore, if you want to
         *                              perform any processing, the callbackFn SHOULD return a Promise: removal will wait for the Promise to be resolved.
         *                              The callbackFn may (but not necessarily) invoke `reply(object)`, which is handy if you want to return any data.
         *                              If so, than reply MUST be invoked with an object, because the client expects this.
         *                              If not, than reply gets invoked automaticly after the callback.
         *
         *                              IMPORTANT NOTE: If the callback replies by itself, than it will also need to set the
         *                              'access-control-allow-origin' headers (if needed). That is: the 5th argument of this method
         *                              is not being used when you manually are replying. These headers will only be needed when using CORS.
         *
         * @param [accessControlAllowOrigin] {String} the content of the `access-control-allow-origin`-response-header
         * @return serverresponse, with the unique clientId as text/html
         * @since 0.0.1
        */
        recieveFile: function(request, reply, maxFileSize, callback, accessControlAllowOrigin) {
            var filedata = request.payload,
                filedataSize = filedata.length,
                fileSize, originalFilename, transId, clientId, partialId, promise, data, totalSize;

            fileSize = request.headers['content-length'];
            originalFilename = request.headers['x-filename'];
            transId = request.headers['x-transid'];
            clientId = request.headers['x-clientid'];
            partialId = request.headers['x-partial'];
            totalSize = request.headers['x-total-size'];
            // create clientid if not defined:
            FILE_TRANSMISSIONS[clientId] || (FILE_TRANSMISSIONS[clientId]={});
            // create transid if not defined, and fill the property `cummulatedSize`:
            if (!FILE_TRANSMISSIONS[clientId][transId]) {
                FILE_TRANSMISSIONS[clientId][transId] = {
                    cummulatedSize: filedataSize
                };
            }
            else {
                FILE_TRANSMISSIONS[clientId][transId].cummulatedSize += filedataSize;
            }
            if (typeof maxFileSize==='function') {
                callback = maxFileSize;
                maxFileSize = null;
            }
            if (!maxFileSize) {
                maxFileSize = maxFileSize || globalMaxFileSize || DEF_MAX_FILESIZE;
            }
            // Abort if the total filesize (of all chunks) exceeds max.
            // check for `totalSize`, which can abort every single chunk --> note: not 100% safe,
            // a user could manipulate request.headers['x-total-size'] manually.
            // Therefore, also check for FILE_TRANSMISSIONS[clientId][transId].cummulatedSize, which is
            // more safe method, but can only abort as soon as the cummulated size exceeds.
            if ((totalSize>maxFileSize) || (FILE_TRANSMISSIONS[clientId][transId].cummulatedSize>maxFileSize)) {
                delete FILE_TRANSMISSIONS[clientId][transId];
                // to keep memory clean: also remove the clientid when there are no current transmissions
                if (FILE_TRANSMISSIONS[clientId].size()===0) {
                    delete FILE_TRANSMISSIONS[clientId];
                }
                reply().code(403);
            }
            else {
                tmpDirCreated
                .then(getUniqueFilename.bind(null, TMP_DIR))
                .then(function(fullFilename) {
                    // fullFilename is the an unique filename that can be used to store the chunk.
                    var partCount,
                        wstream = fs.createWriteStream(fullFilename);
                    // write the chunk:
                    wstream.write(filedata);
                    // close the stream: wait until all has finished before continue: use wstream.endPromise():
                    return wstream.endPromise().then(function() {
                        // now save the chunk's filename:
                        FILE_TRANSMISSIONS[clientId][transId][partialId] = fullFilename;
                        // if the last part is send, then `originalFilename` and posible additional data `x-data` is defined.
                        // in which case we can set the property: `count`
                        // Be aware: the last part me arive sooner than other parts!
                        if (originalFilename) {
                            FILE_TRANSMISSIONS[clientId][transId].count = parseInt(partialId, 10);
                            FILE_TRANSMISSIONS[clientId][transId].filename = originalFilename;
                            // store any params that might have been sent with the request:
                            data = request.headers['x-data'];
                            if (data) {
                                try {
                                    FILE_TRANSMISSIONS[clientId][transId].data = JSON.parse(data, REVIVER);
                                }
                                catch(err) {
                                    console.log(err);
                                    FILE_TRANSMISSIONS[clientId][transId].data = {};
                                }
                            }
                            else {
                                FILE_TRANSMISSIONS[clientId][transId].data = {};
                            }
                        }
                        // if all parts are processed, we can build the final file:
                        partCount = FILE_TRANSMISSIONS[clientId][transId].count;
                        if (partCount && (FILE_TRANSMISSIONS[clientId][transId].size()===(partCount+4))) {
                            // define any params (stored at FILE_TRANSMISSIONS[clientId][transId].data)
                            // and make them available at request.params:
                            request.params || (request.params={});
                            request.params.merge(FILE_TRANSMISSIONS[clientId][transId].data);
                            // return a Promise, that resolves with the unique filename of the rebuild file
                            // `getFinalFile` will rebuild and take care of removal of the intermediate chunk-files:
                            promise = getFinalFile(TMP_DIR, FILE_TRANSMISSIONS[clientId][transId]);
                        }
                        else {
                            // intermediate response:
                            // resolve without any data
                            promise = Promise.resolve();
                        }
                        return promise.then(function(filedata) {
                            // if `filedata` is there, than it is the full-filename of the build-file.
                            // In which case all has been processed.
                            // If there is no `filedata` than it is an intermediate request, and we should reply without calling the callback
                            var wrapper;
                            wrapper = ((filedata && (typeof callback==='function')) ? callback(filedata.tmpBuildFilename, filedata.originalFilename) : null);
                            Promise.resolve(wrapper).then(function() {
                                var replyInstance;
                                if (!reply._replied) {
                                    // either intermediate response, or the final response when `callback` did no reply() invocation
                                    replyInstance = reply({status: filedata ? 'OK' : 'BUSY'});
                                    accessControlAllowOrigin && (replyInstance.header('access-control-allow-origin', accessControlAllowOrigin));
                                }
                                if (filedata) {
                                    delete FILE_TRANSMISSIONS[clientId][transId];
                                    // to keep memory clean: also remove the clientid when there are no current transmissions
                                    if (FILE_TRANSMISSIONS[clientId].size()===0) {
                                        delete FILE_TRANSMISSIONS[clientId];
                                    }
                                    return removeFile(filedata.tmpBuildFilename);
                                }
                            });
                        }).catch(function(err) {console.log(err);});
                    });
                }).catch(function(err) {
                    console.log(err);
                });
            }
        }
    };
};

module.exports = handleFile;