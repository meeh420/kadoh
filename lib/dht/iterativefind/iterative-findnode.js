var IterativeDeferred   = require('../../util/iterative-deferred');
var XORSortedPeerArray  = require('../../util/xorsorted-peerarray');
var PeerArray           = require('../../util/peerarray');
var Peer                = require('../peer');
var globals             = require('../../globals');
var FindNodeRPC        = require('../../network/rpc/findnode');

var IterativeFindValue = module.exports = IterativeDeferred.extend({
  initialize: function(target, sendFn, sendCtxt) {
    this.supr();
    this._target = (target instanceof Peer) ? target.getID() : target;

     //hack
    this._targetType = 'NODE';

    this.sendFn = function() {
      sendFn.apply(sendCtxt, arguments);
    };

    this.init(new XORSortedPeerArray().setRelativeNodeID(this._target));
  },

  mapFn: function(peer) {
    var rpc = new FindNodeRPC(peer, this._target);
    this.sendFn(rpc);
    return rpc;
  },

  reduceFn: function(new_peers, peers, map) {
    peers.add(new_peers);

    //did we found a peer with same ID ?
    //var found = new_peers.filterByID(this._target);
    //if(!found.empty())
      //return this.resolve(found.getPeer(0), reached);

    if(peers.newClosest())
      peers.pickOutFirst(globals.ALPHA).forEach(map);

    return peers;
  },

  finalyFn: function(reduced, reached) {
    this.reject(new XORSortedPeerArray(reached, this._target));
  }
});