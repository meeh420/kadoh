// Dep: [lawnchair]/lawnchair
// Dep: [KadOH]/core/eventemitter
// Dep: [KadOH]/globals
// Dep: [KadOH]/peer
// Dep: [KadOH]/core/deferred
(function(exports, Lawnchair) {

  if (!Lawnchair) {
    if ('object' == typeof console) 
      console.warn('WARNING : Lawnchair not defined : no storage');
    return;
  }

  var KadOH        = exports,
      EventEmitter = KadOH.core.EventEmitter,
      globals      = KadOH.globals,
      Peer         = KadOH.Peer,
      Deferred     = KadOH.core.Deferred;


  KadOH.ValueManagement = EventEmitter.extend({

    /**
     * Instanciate a new value management.
     * 
     * @constructs
     * @param  {Object} node    The node instance on which the value mangement depends.
     * @param  {Object} [options] Some configuration options..
     * @param  {Boolean} [options.recover = true] If true, try to recover the last session that 
     *                                    coresponds to the address/nodeID. If false, session is 
     *                                    destructed and a new one is created.
     */
    initialize: function(node, options) {
      this.supr();
      this._node = node;

      options = options || {};
      options.recover = options.recover === true ? true : false;

      //TODO : recover last session storage
      this._store = new Lawnchair({ 
        name   : 'KadOH-'+node.getAddress()+'/'+node.getID(),
        record : 'KeyValue'
      },
      function(){});

      if(options.recover){
        this._recover();
        } else {
        this._store.nuke();          
        }
    },

    /**
     * Store the given key/value in the storage. Provide an expirimation time.
     * Return ta deferred object representig the state of the store (resolved : OK, rejected : not OK).
     * 
     * Expiration time : negative value or not set : no expiration.
     * 
     * In the background, timers for republish and expiration are started.
     * 
     * @public
     * @see  Deferred
     * 
     * @param  {String}   key   the key associated to the value
     * @param  {*}        value the value of the key value
     * @param  {Integer}  [exp = -1]   timestamp for the expiration date (UTC in ms). If negative value or not set : no expiration.
     * @return {Deferred} a deferred object representing the state of the store
     */

    store: function(key, value, exp) {
      var def = new Deferred();

      var KeyValue = {
        key   : key,
        value : value
      };

      var now = +(new Date());

      //set republish date
      KeyValue.rep =  now + this._repTime;

      //check expiration time : negative value means infinite.
      KeyValue.exp = exp || -1;

      if(exp <= now) {
        KeyValue.now = now;
        this.emit('fail store', 'key-value already expired', KeyValue);
        def.reject('key-value already expired');
        return def;
      }

      //set the timers
      this._setRepTimout(KeyValue, this._repTime);
      this._setExpTimout(KeyValue, KeyValue.exp - now);

      //and save
      this._store.save(KeyValue, function(obj) {
        def.resolve(obj);
      });

      return def;
    },

    /**
     * Retrive the value of the key and passes it as argument of the calback function 
     * with the expiration time.
     * 
     * Are passed as arguments of the callbak :
     *   value - the value that coresspond to the key (null if not found)
     *   exp   - expiration date (null or negative if unlimited)
     *   
     * @public
     *   
     * @param  {String}   key      the key associated to the value
     * @param  {Function} callback callback function
     * @param  {Object}   [scope = this ValueManagement obejct] the scope to apply to the callback function (by default : the instance of ValuManagement)
     * @return {ValueManagement} This instance of ValueManagement
     */

    retrieve: function(key, callback, scope) {
      scope = scope || this;
      this._store.get(key, function(obj) {
        if(obj === null) callback.call(scope, null);
        else {
          callback.call(scope, 
                        obj.value, 
                        obj.exp < 0 ? null : obj.exp
                      );
        }
      });
      return this;
    },

    /**
     * Recover the last stored session.
     * 
     * @private
     */
    _recover: function() {
      var now = + (new Date());
      var self = this;

      this._store.each(function(kv){
        try {
          if(kv.exp >= 0 && kv.exp <= now) {
            self._store.remove(kv.key);
            return;
          }
          self._setExpTimout(kv,kv.exp - now);
          
          if(typeof kv.rep == 'undefined' || kv.exp <= now) {
            self._republish(kv);
            kv.rep =  now + self._repTime;
            self._store.save(kv);
          }
           
          self._setRepTimout(kv, kv.rep - now);
          
        } catch(e) {
          self._store.remove(kv.key);
        }
      });
    },

    /**
     * Reset a timeout for republish of the given Key/Value
     * 
     * @private
     * @param {[type]} kv      Key/Value
     * @param {[type]} timeout the timeout
     */
    _setRepTimout: function(kv, timeout) {
      setTimeout(function(kv, self) {
        if(typeof self == 'undefined') return; //in case of
        self._republish(kv);
      }, timeout, kv, this);
      return this;
    },

    /**
     * Time between 2 republish processes of a stored value. 
     * By default, the value is the TIMEOUT_REPUBLISH global constant.
     * 
     * @private
     * @type {Integer}
     */
    _repTime : globals.TIMEOUT_REPUBLISH,

    /**
     * Make a key/value being republished by calling the `republish` method of node instance. 
     * 
     * Before it checks if key/value is still existing. Reset a new timer.
     * 
     * @param  {Object} kv the key/value object to republish
     * @return {Object} this
     */
    _republish: function(kv) {
      var self = this;
      //check before if the key/value still exists
        this._store.exists(kv.key, function(exists) {
          if(exists) {
            //call node's republish method
            self._node.republish(kv.key, kv.value, kv.exp)
            ;
            //reset republish date
            var now = +(new Date());
            kv.rep = now + this._repTime;

            //reset a timer
            self._setRepTimout(kv, self._repTime);
            
            //sore it
            self._store.save(kv);

            }
        });
      return this;
    },

    /**
     * Reset a timeout for expiration of the given Key/Value.
     * If the Key/Value has a negative expiration date (infinite), nothing is done.
     * 
     * @private
     * @param {[type]} kv      Key/Value
     * @param {[type]} timeout the timeout
     * @return this
     */
    _setExpTimout: function(kv, timeout) {
      if(kv.exp >= 0) {
        setTimeout(function(kv, self) {
          if(typeof self == 'undefined') return; //in case of
          self._expire(kv);
        }, timeout, kv, this);  
      }
      return this;
    },

    /**
     * Make a key/value expire. Before check if stil exists.
     * 
     * @private
     * @param  {Object} kv the key/value to make expire
     * @return {Object} this
     */
    _expire: function(kv) {
      var self = this;
      //check before if the key/value still exists
        this._store.exists(kv.key, function(exists) {
          if(exists) {
            self._store.remove(kv.key);
            self.emit('expire', kv);
          }
        });
      return this;
    }

  });


})('object' === typeof module ? module.exports : (this.KadOH = this.KadOH || {}),
   'undefined' == typeof Lawnchair ? undefined : Lawnchair);