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
    utils = require('itsa-utils'),
    idGenerator = utils.idGenerator,
    TMP_FILE = 'tmp-file',
    fileUtils;

require('itsa-jsext');
require('fs-extra');
require('itsa-writestream-promise'); // extends fs.WriteStream with .endPromise

fileUtils = {
    /**
     * Generates an unique filename in the specified folder.
     *
     * @method getUniqueFilename
     * @param folder {String} the folder where the filename should reside
     * @return {String} unique filename
     * @since 0.0.1
    */
    getUniqueFilename: function(folder, extention) {
        var tmpFilename = idGenerator(TMP_FILE)+'-'+Date.now(),
            nameReserved;
        extention && (extention="."+extention);
        nameReserved = function(filename, i) {
            var fullFilename = filename + (i>0 ? '-'+i : '');
            return fsp.exists(fullFilename).then(function(exists) {
                return exists ? nameReserved(filename, i+1) : (fullFilename+(extention || ''));
            });
        };
        return nameReserved(folder + tmpFilename, 0);
    },

    /**
     * Creates a folder (if it should not exists)
     *
     * @method createDir
     * @param folder {String} the folder where the filename should reside
     * @return {Promise} resolved when ready, returnvaoue is the folder
     * @since 0.0.1
    */
    createDir: function(folder) {
        return fsp.exists(folder).then(function(exists) {
            if (!exists) {
                return fsp.mkdirs(folder);
            }
            return Promise.resolve(folder);
        });
    },

    /**
     * Removes a file (if exists)
     *
     * @method removeFile
     * @param filename {String} the full absolute filename that should be removed
     * @return {Promise} resolved when ready
     * @since 0.0.1
    */
    removeFile: function(filename) {
        return fsp.exists(filename).then(function(exists) {
            if (exists) {
                return fsp.unlink(filename);
            }
        });
    },

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
    getFinalFile: function(folder, transmission) {
        var dot = transmission.filename.lastIndexOf("."),
            extention = (dot!==-1) ? transmission.filename.substr(dot+1) : null;
        return fileUtils.getUniqueFilename(folder, extention).then(function(tmpBuildFilename) {
            var partCount = transmission.count,
                wstream = fs.createWriteStream(tmpBuildFilename),
                appendFileData;

            appendFileData = function(part) {
                return fsp.readFile(transmission[part]).then(function(data) {
                    // TODO: wait for asynchronious finishing writing
                    wstream.write(data);
                    if (part===partCount) {
                        return wstream.itsa_endPromise().itsa_finally(function() {
                            // remove all temporarely files
                            transmission.itsa_each(function(filename, key) {
                                key.itsa_isValidNumber() && fileUtils.removeFile(filename);
                            });
                        });
                    }
                    return appendFileData(part+1);
                });
            };

            return appendFileData(1).then(function() {
                return {
                    originalFilename: transmission.filename,
                    tmpBuildFilename: tmpBuildFilename
                };
            });
        });
    }

};

module.exports = fileUtils;
