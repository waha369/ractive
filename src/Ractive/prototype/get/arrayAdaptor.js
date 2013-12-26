define([
	'config/types',
	'utils/defineProperty',
	'utils/isArray',
	'shared/clearCache',
	'shared/preDomUpdate',
	'shared/postDomUpdate',
	'shared/makeTransitionManager',
	'shared/notifyDependants'
], function (
	types,
	defineProperty,
	isArray,
	clearCache,
	preDomUpdate,
	postDomUpdate,
	makeTransitionManager,
	notifyDependants
) {

	'use strict';

	var arrayAdaptor,

		// helpers
		notifyArrayDependants,
		ArrayWrapper,
		patchArrayMethods,
		unpatchArrayMethods,
		patchedArrayProto,
		testObj,
		mutatorMethods,
		noop,
		errorMessage;


	arrayAdaptor = {
		filter: function ( object ) {
			// wrap the array if a) b) it's an array, and b) either it hasn't been wrapped already,
			// or the array didn't trigger the get() itself
			return isArray( object ) && ( !object._ractive || !object._ractive.setting );
		},
		wrap: function ( ractive, array, keypath ) {
			return new ArrayWrapper( ractive, array, keypath );
		}
	};

	ArrayWrapper = function ( ractive, array, keypath ) {
		this.root = ractive;
		this.value = array;
		this.keypath = keypath;

		// if this array hasn't already been ractified, ractify it
		if ( !array._ractive ) {

			// define a non-enumerable _ractive property to store the wrappers
			defineProperty( array, '_ractive', {
				value: {
					wrappers: [],
					instances: [],
					setting: false
				},
				configurable: true
			});

			patchArrayMethods( array );
		}

		// store the ractive instance, so we can handle transitions later
		if ( !array._ractive.instances[ ractive._guid ] ) {
			array._ractive.instances[ ractive._guid ] = 0;
			array._ractive.instances.push( ractive );
		}

		array._ractive.instances[ ractive._guid ] += 1;
		array._ractive.wrappers.push( this );
	};

	ArrayWrapper.prototype = {
		get: function () {
			return this.value;
		},
		teardown: function () {
			var array, storage, wrappers, instances, index;

			array = this.value;
			storage = array._ractive;
			wrappers = storage.wrappers;
			instances = storage.instances;

			// if teardown() was invoked because we're clearing the cache as a result of
			// a change that the array itself triggered, we can save ourselves the teardown
			// and immediate setup
			if ( storage.setting ) {
				return false; // so that we don't remove it from this.root._wrapped
			}

			index = wrappers.indexOf( this );
			if ( index === -1 ) {
				throw new Error( errorMessage );
			}

			wrappers.splice( index, 1 );

			// if nothing else depends on this array, we can revert it to its
			// natural state
			if ( !wrappers.length ) {
				delete array._ractive;
				unpatchArrayMethods( this.value );
			}

			else {
				// remove ractive instance if possible
				instances[ this.root._guid ] -= 1;
				if ( !instances[ this.root._guid ] ) {
					index = instances.indexOf( this.root );

					if ( index === -1 ) {
						throw new Error( errorMessage );
					}

					instances.splice( index, 1 );
				}
			}
		}
	};


	notifyArrayDependants = function ( array, methodName, args ) {
		var notifyKeypathDependants,
			queueDependants,
			wrappers,
			wrapper,
			i;

		notifyKeypathDependants = function ( root, keypath ) {
			var depsByKeypath, deps, keys, upstreamQueue, smartUpdateQueue, dumbUpdateQueue, i, changed, start, end, childKeypath, lengthUnchanged;

			// If this is a sort or reverse, we just do root.set()...
			if ( methodName === 'sort' || methodName === 'reverse' ) {
				root.set( keypath, array );
				return;
			}

			// ...otherwise we do a smart update whereby elements are added/removed
			// in the right place. But we do need to clear the cache
			clearCache( root, keypath );

			// Find dependants. If any are DOM sections, we do a smart update
			// rather than a ractive.set() blunderbuss
			smartUpdateQueue = [];
			dumbUpdateQueue = [];

			for ( i=0; i<root._deps.length; i+=1 ) { // we can't cache root._deps.length as it may change!
				depsByKeypath = root._deps[i];

				if ( !depsByKeypath ) {
					continue;
				}

				deps = depsByKeypath[ keypath ];

				if ( deps ) {
					queueDependants( keypath, deps, smartUpdateQueue, dumbUpdateQueue );

					// we may have some deferred evaluators to process
					preDomUpdate( root );

					while ( smartUpdateQueue.length ) {
						smartUpdateQueue.pop().smartUpdate( methodName, args );
					}

					while ( dumbUpdateQueue.length ) {
						dumbUpdateQueue.pop().update();
					}
				}
			}

			// if we're removing old items and adding new ones, simultaneously, we need to force an update
			if ( methodName === 'splice' && ( args.length > 2 ) && args[1] ) {
				changed = Math.min( args[1], args.length - 2 );
				start = args[0];
				end = start + changed;

				if ( args[1] === ( args.length - 2 ) ) {
					lengthUnchanged = true;
				}

				for ( i=start; i<end; i+=1 ) {
					childKeypath = keypath + '.' + i;
					notifyDependants( root, childKeypath );
				}
			}

			preDomUpdate( root ); // TODO determine whether this is necessary

			// Finally, notify direct dependants of upstream keypaths...
			upstreamQueue = [];

			keys = keypath.split( '.' );
			while ( keys.length ) {
				keys.pop();
				upstreamQueue[ upstreamQueue.length ] = keys.join( '.' );
			}

			notifyDependants.multiple( root, upstreamQueue, true );

			// length property has changed - notify dependants
			// TODO in some cases (e.g. todo list example, when marking all as complete, then
			// adding a new item (which should deactivate the 'all complete' checkbox
			// but doesn't) this needs to happen before other updates. But doing so causes
			// other mental problems. not sure what's going on...
			if ( !lengthUnchanged ) {
				notifyDependants( root, keypath + '.length', true );
			}
		};

		// TODO can we get rid of this whole queueing nonsense?
		queueDependants = function ( keypath, deps, smartUpdateQueue, dumbUpdateQueue ) {
			var k, dependant;

			k = deps.length;
			while ( k-- ) {
				dependant = deps[k];

				// references need to get processed before mustaches
				if ( dependant.type === types.REFERENCE ) {
					dependant.update();
				}

				// is this a DOM section?
				else if ( dependant.keypath === keypath && dependant.type === types.SECTION && !dependant.inverted && dependant.docFrag ) {
					smartUpdateQueue[ smartUpdateQueue.length ] = dependant;

				} else {
					dumbUpdateQueue[ dumbUpdateQueue.length ] = dependant;
				}
			}
		};

		// Iterate through all wrappers associated with this array, notifying them
		wrappers = array._ractive.wrappers;
		i = wrappers.length;
		while ( i-- ) {
			wrapper = wrappers[i];
			notifyKeypathDependants( wrapper.root, wrapper.keypath );
		}
	};


	patchedArrayProto = [];
	mutatorMethods = [ 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift' ];
	noop = function () {};

	mutatorMethods.forEach( function ( methodName ) {
		var method = function () {
			var result, instances, instance, i, previousTransitionManagers = {}, transitionManagers = {};

			// apply the underlying method
			result = Array.prototype[ methodName ].apply( this, arguments );

			// create transition managers
			instances = this._ractive.instances;
			i = instances.length;
			while ( i-- ) {
				instance = instances[i];

				previousTransitionManagers[ instance._guid ] = instance._transitionManager;
				instance._transitionManager = transitionManagers[ instance._guid ] = makeTransitionManager( instance, noop );
			}

			// trigger changes
			this._ractive.setting = true;
			notifyArrayDependants( this, methodName, arguments );
			this._ractive.setting = false;

			// initialise transition managers
			i = instances.length;
			while ( i-- ) {
				instance = instances[i];

				instance._transitionManager = previousTransitionManagers[ instance._guid ];
				transitionManagers[ instance._guid ].ready();

				preDomUpdate( instance );
				postDomUpdate( instance );
			}

			return result;
		};

		defineProperty( patchedArrayProto, methodName, {
			value: method
		});
	});


	// can we use prototype chain injection?
	// http://perfectionkills.com/how-ecmascript-5-still-does-not-allow-to-subclass-an-array/#wrappers_prototype_chain_injection
	testObj = {};
	if ( testObj.__proto__ ) {
		// yes, we can
		patchArrayMethods = function ( array ) {
			array.__proto__ = patchedArrayProto;
		};

		unpatchArrayMethods = function ( array ) {
			array.__proto__ = Array.prototype;
		};
	}

	else {
		// no, we can't
		patchArrayMethods = function ( array ) {
			var i, methodName;

			i = mutatorMethods.length;
			while ( i-- ) {
				methodName = mutatorMethods[i];
				defineProperty( array, methodName, {
					value: patchedArrayProto[ methodName ],
					configurable: true
				});
			}
		};

		unpatchArrayMethods = function ( array ) {
			var i;

			i = mutatorMethods.length;
			while ( i-- ) {
				delete array[ mutatorMethods[i] ];
			}
		};
	}


	errorMessage = 'Something went wrong in a rather interesting way';

	return arrayAdaptor;

});