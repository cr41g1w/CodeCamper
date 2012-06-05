﻿define(['jquery', 'underscore', 'ko', 'model', 'model.mapper', 'dataservice', 'config', 'utils'],
    function ($, _, ko, model, modelmapper, dataservice, config, utils) {
        var
            logger = config.logger,

            getCurrentUserId = function () {
                return config.currentUser().id();
            },

            itemsToArray = function (items, observableArray, filter, sortFunction) {
                if (!observableArray) return;

                observableArray([]); // clear the old observableArray

                var underlyingArray = utils.mapMemoToArray(items);

                if (filter) {
                    underlyingArray = _.filter(underlyingArray, function(o) {
                        var match = filter.predicate(filter, o);
                        return match;
                    });
                }
                if (sortFunction) {
                    underlyingArray.sort(sortFunction);
                }
                //logger.info('Fetched, filtered and sorted ' + underlyingArray.length + ' records');
                observableArray(underlyingArray);
                //observableArray.valueHasMutated() /// dont need it since we blow away the old observable contents
            },

            mapToContext = function (dtoList, items, results, mapper, filter, sortFunction) {
                // Loop through the raw dto list and populate a dictionary of the items
                items = _.reduce(dtoList, function (memo, dto) {
                    // ToDo: Just like mapDtoToContext ... refactor it
                    var id = mapper.getDtoId(dto);
                    var existingItem = items[id];
                    memo[id] = mapper.fromDto(dto, existingItem);
                    return memo;
                }, { });
                itemsToArray(items, results, filter, sortFunction);
                //logger.success('received with ' + dtoList.length + ' elements');
                return items; // must return these
            },

            EntitySet = function(getFunction, mapper, nullo) {
                var
                    items = {},

                    // returns the model item produced by merging dto into context
                    mapDtoToContext = function (dto) {
                        var id = mapper.getDtoId(dto);
                        var existingItem = items[id];
                        items[id] = mapper.fromDto(dto, existingItem);
                        return items[id];
                    },

                    add = function (newObj) {
                        items[newObj.id()] = newObj;
                    },

                    removeById = function (id) {
                        delete items[id];
                    },

                    getLocalById = function (id) {
                        return !!id && !!items[id] ? items[id] : nullo;
                    },

                    getData = function (options) {
                        return $.Deferred(function(def) {
                            var results = options && options.results,
                                sortFunction = options && options.sortFunction,
                                filter = options && options.filter,
                                forceRefresh = options && options.forceRefresh,
                                param = options && options.param;
                            if (!items || !utils.hasProperties(items) || forceRefresh) {
                                getFunction({
                                    success: function(dtoList) {
                                        items = mapToContext(dtoList, items, results, mapper, filter, sortFunction);
                                        def.resolve(dtoList);
                                    },
                                    error: function() {
                                        logger.error('oops! data could not be retrieved'); //TODO: get rid of this
                                        def.reject();
                                    }
                                }, param);
                            } else {
                                itemsToArray(items, results, filter, sortFunction);
                                def.resolve(results);
                            }
                        }).promise();
                    };
                
                return {
                    mapDtoToContext: mapDtoToContext,
                    add: add,
                    getLocalById: getLocalById,
                    getData: getData,
                    removeById: removeById
                };
            },

            SessionSpeakerEntitySet = function () {
                var
                    items = {},

                    add = function (personId, sessionIds) {
                        // adds a new property for the personId passed in with an array of session ids
                        items[personId] = sessionIds;
                    },

                    removeById = function (personId) {
                        // Removes an entire array of session ids for the personId passed in
                        // Causes observables to be notified (ex: unmarking a favorite)
                        items[personId] = [];
                    },

                    removeSessionById = function (personId, sessionId) {
                        // Removes 1 session id for the personId passed in
                        // Causes observables to be notified (ex: unmarking a favorite)
                        items[personId] = _.without(items[personId], sessionId);
                    },

                    getLocalById = function (personId) {
                        // Gets an array of session ids for the personId passed in
                        return !!personId && !!items[personId] ? items[personId] : [];
                    },

                    crossMatchSpeakers = function (observableArray, filter, sortFunction) {
                        if (!observableArray) return;
                        // clear out the results observableArray
                        observableArray([]);

                        var underlyingArray = observableArray();
                        // get an array of persons
                        for (var prop in items) {
                            if (items.hasOwnProperty(prop)) {
                                underlyingArray.push(persons.getLocalById(prop));
                            }
                        }
                        if (filter) {
                            underlyingArray = _.filter(underlyingArray, function(o) {
                                var match = filter.predicate(filter, o);
                                return match;
                            });
                        }
                        if (sortFunction) {
                            underlyingArray.sort(sortFunction);
                        }
                        observableArray(underlyingArray);
                    },

                    getData = function (options) {
                        var results = options && options.results,
                            sortFunction = options && options.sortFunction,
                            filter = options && options.filter,
                            forceRefresh = options && options.forceRefresh;
                        if (!results) {
                            results = ko.observableArray([]);
                        }
                        if (!items || !utils.hasProperties(items) || forceRefresh) {
                            // create the memo for it and go get the Person objects from the DC
                            var sessionResults = ko.observableArray([]);
                            $.when(sessions.getData({ results: sessionResults })
                                .done(function() {
                                    if (sessionResults() && sessionResults().length) {
                                        var underlyingArraySessions = sessionResults();
                                        // create the items memo of items[speakerId] = [sessionId_1, sessionId_1, sessionId_n]
                                        // TODO: use underscore to trim this down
                                        for (var i = 0; i < underlyingArraySessions.length; i++) {
                                            var s = underlyingArraySessions[i];
                                            items[s.speakerId()] = items[s.speakerId()] || [];
                                            items[s.speakerId()].push(s.id());
                                        }
                                        crossMatchSpeakers(results, filter, sortFunction);
                                    } else {
                                        logger.error('oops! data could not be retrieved'); //TODO: get rid of this
                                        return;
                                    }

                                }));
                        } else {
                            crossMatchSpeakers(results, filter, sortFunction);
                        }
                    };
                
                return {
                    add: add,
                    getLocalById: getLocalById,
                    getData: getData,
                    removeById: removeById,
                    removeSessionById: removeSessionById
                };
            },

            attendance = new EntitySet(dataservice.attendance.getAttendance, modelmapper.attendance, model.attendanceNullo),
            rooms = new EntitySet(dataservice.lookup.getRooms, modelmapper.room, model.roomNullo),
            sessions = new EntitySet(dataservice.session.getSessionBriefs, modelmapper.session, model.sessionNullo),
            persons = new EntitySet(dataservice.person.getSpeakers, modelmapper.person, model.personNullo),
            timeslots = new EntitySet(dataservice.lookup.getTimeslots, modelmapper.timeSlot, model.timeSlotNullo),
            tracks = new EntitySet(dataservice.lookup.getTracks, modelmapper.track, model.trackNullo),
            sessionSpeakers = new SessionSpeakerEntitySet();

            // Attendance extensions
            var attendanceCud = {
                addAttendance: function (sessionModel, callbacks) {
                    var attendanceModel = new model.Attendance()
                            .sessionId(sessionModel.id())
                            .personId(getCurrentUserId()),
                            attendanceModelJson = ko.toJSON(attendanceModel);
                    //var data2 = JSON.stringify(attendanceModel);
                    dataservice.attendance.addAttendance({
                        success: function (dto) {
                            if (!dto) {
                                logger.error('oops! data could not be posted'); //TODO: revise error message
                                if (callbacks && callbacks.error) { callbacks.error(); }
                                return;
                            }
                            var newAtt = modelmapper.attendance.fromDto(dto); // Map DTO to Model
                            attendance.add(newAtt); // Add to the datacontext
                            sessionModel.isFavoriteUpdate.notifySubscribers(); // Trigger re-evaluation of isFavorite
                            logger.success('Added attendance!'); //TODO: 
                            if (callbacks && callbacks.success) { callbacks.success(newAtt); }
                        },
                        error: function (response) {
                            logger.error('oops! data could not be posted'); //TODO: revise error message
                            if (callbacks && callbacks.error) { callbacks.error(); }
                            return;
                        }
                    }, attendanceModelJson);
                },

                updateAttendance: function () {
                    //TODO: implement updateAttendance
                    logger.warning('implement updateAttendance');
                },
                
                deleteAttendance: function (sessionModel, callbacks) {
                    var attendanceModel = sessionModel.attendance();
                    dataservice.attendance.deleteAttendance({
                        success: function (response) {
                            attendance.removeById(attendanceModel.id());
                            sessionModel.isFavoriteUpdate.notifySubscribers(); // Trigger re-evaluation of isFavorite
                            logger.success('Deleted attendance!'); //TODO: 
                            if (callbacks && callbacks.success) { callbacks.success(); }
                        },
                        error: function (response) {
                            logger.error('oops! data could not be deleted'); //TODO: revise error message
                            if (callbacks && callbacks.error) { callbacks.error(); }
                            return;
                        }
                    }, attendanceModel.personId(), attendanceModel.sessionId());
                }
            };

        // extend Attendance entityset with ability to get attendance for the current user (aka, the favorite)
        attendance.getSessionFavorite = function (sessionId) {
            return attendance.getLocalById(model.Attendance.makeId(getCurrentUserId(), sessionId));
        };
        
        // extend Sessions enttityset 
        sessions.getFullSessionById = function(id, callbacks) {
            var session = sessions.getLocalById(id);
            if (session.isNullo || session.isBrief())
            {
                // if nullo or brief, get fresh from database
                dataservice.session.getSession(id, {
                    success: function (dto) {
                        // updates the session returned from getLocalById() above
                        session = sessions.mapDtoToContext(dto);
                        session.isBrief(false); // now a full session
                        //logger.success('merged full session'); //TODO: revise message
                        callbacks.success(session); 
                    },
                    error: function(response) {
                        logger.error('oops! could not retrieve session '+id); //TODO: revise error message
                        if (callbacks && callbacks.error) { callbacks.error(response); }
                    }
                                
                });
            }
            return session; // immediately return cached session (nullo, brief, or full)
        };

        // extend Persons entitySet 
        persons.getFullPersonById = function(id, callbacks) {
            var person = persons.getLocalById(id);
            if (person.isNullo || person.isBrief())
            {
                // if nullo or brief, get fresh from database
                dataservice.person.getPerson(id, {
                    success: function (dto) {
                        // updates the person returned from getLocalById() above
                        person = persons.mapDtoToContext(dto);
                        person.isBrief(false); // now a full session
                        logger.success('merged full person'); //TODO: revise message
                        callbacks.success(person); 
                    },
                    error: function(response) {
                        logger.error('oops! could not retrieve person '+id); //TODO: revise error message
                        if (callbacks && callbacks.error) { callbacks.error(response); }
                    }
                                
                });
            }
            return person; // immediately return cached person (nullo, brief, or full)
        };
        
        //TODO: In dataContext:
        // 1) I have not tested forceRefresh = true. it might work :D
        // 2) Need to add code for allowing the datacontext.persons to get a real person vs speaker (brief).
        // 3) Add code for allowing datacontext.sessions to get a real session, not a brief

        return {
            attendance: attendance,
            persons: persons,
            rooms: rooms,
            sessions: sessions,
            sessionSpeakers: sessionSpeakers,
            timeslots: timeslots,
            tracks: tracks,
            attendanceCud: attendanceCud
    };
});