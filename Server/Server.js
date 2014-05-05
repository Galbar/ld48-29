var io = require("socket.io").listen(5465);
var Player = require('./Player');
var Match = require('./Match');

io.set('log level', 1);

var MAX_PLAYERS = 2;
var ROUND_SECONDS = 5;

function Server () {
	this.players = [];  // Player objects
	this.playersWaiting = [];  // player id
	this.playerGroups = [];
	this.playerGroupsWaiting = [];
	this.matches = [];  // Match objects
	this.ongoingMatches = [];  // match id
}

Server.prototype.handleGroup = function(player, code) {
	if ( this.playerGroups[code] == undefined )
		this.playerGroups[code] = [];
	if ( this.playerGroups[code].length <= MAX_PLAYERS )
	{
		this.playerGroups[code].push( player );
		var a = [];
		for (var i = 0; i < this.playerGroups[code].length; i++) {
			p = this.playerGroups[code][i];
			a.push({id: p.socketId, username: p.username});
		};
		io.sockets.sockets[player.socketId].emit( "grouped", a );
	}
	else
	{
		io.sockets.sockets[player.socketId].emit( "failedToGroup" );
	}
};

Server.prototype.matchMake = function() {
	console.log("new Match");
	var matchPlayers = [];
	for (var i = 0; i < MAX_PLAYERS; ++i)
	{
		var plId = this.playersWaiting.shift();
		var pl = this.players[plId];
		matchPlayers.push( pl );
	}

	var match = new Match( matchPlayers );
	var matchId = this.matches.length;
	this.matches.push( match );

	for (var i = 0; i < MAX_PLAYERS; ++i)
	{
		var plId = matchPlayers[i].socketId;
		this.players[plId].matchId = matchId;
		if ( this.players[plId].alive )
			io.sockets.sockets[plId].emit( "startGame", match );
	}
};

Server.prototype.start = function() {
	var self = this;
	io.sockets.on('connection', function (socket) {
		socket.on('join', function (request) {
			console.log('join');
			self.players[socket.id] = new Player(request.username, socket.id);
			if ( request.code != "" )
				self.handleGroup( self.players[socket.id], request.code );
			else
			{
				self.playersWaiting.push(socket.id);

				while (self.playersWaiting.length >= MAX_PLAYERS)
				{
					self.matchMake();
				}
			}
		});

		socket.on('animationReady', function () {
			console.log('animationReady');
			var plId = socket.id;
			var player = self.players[plId];
			player.ready = true;
			var match = self.matches[player.matchId];
			if ( match.playersReady() )
			{
				for (var i = 0; i < match.players.length; i++) {
					if ( match.players[i] != undefined && match.players[i].alive )
						io.sockets.sockets[match.players[i].socketId].emit( "startNewRound" );
				};
				match.lastRoundTimeStart = +new Date();
				console.log(match.lastRoundTimeStart);
				self.ongoingMatches.push(player.matchId);
			}
		});

		socket.on("action", function (action) {
			console.log("action");
			var plId = socket.id;
			var player = self.players[plId];
			player.nextActions = action;
		});

		socket.on('disconnect', function (data) {
			console.log('disconnect');
			var plId = socket.id;
			var player = self.players[plId];
			for (var i = 0; i < self.playersWaiting.length; i++) {
				if ( self.playersWaiting[i] == player ) {
					self.playersWaiting.splice(i,1);
					console.log("hai");
					break;
				}
			};
			self.players[plId] = undefined;
		});

		socket.on( 'groupReady', function (data){
			var pg = self.playerGroups.splice(data,1);
			self.playersWaiting.push(pg);
			self.matchMake();
		});
	});
	setInterval(this.loop.bind(this), 1000);
};


Server.prototype.loop = function() {
	console.log("Loop");
	console.log(JSON.stringify(this));
	while( this.ongoingMatches.length > 0 && +new Date() - this.matches[this.ongoingMatches[0]].lastRoundTimeStart >= ROUND_SECONDS*1000 )
	{
		console.log(+new Date() - this.matches[this.ongoingMatches[0]].lastRoundTimeStart);
		var matchId = this.ongoingMatches.shift();
		var match = this.matches[matchId];
		if (!match.empty())
		{
			console.log("match is not empty");
			var actions = [];
			for (var i = 0; i < match.players.length; i++) {
				if ( match.players[i] != undefined && match.players[i].alive && match.players[i].nextActions != undefined )
				{
					actions.push({id: match.players[i].socketId, actions: match.players[i].nextActions});
					match.players[i].nextActions = undefined;
				}
			};
			for (var i = 0; i < match.players.length; i++) {
				match.players[i].ready = false;
				if ( match.players[i] != undefined && io.sockets.sockets[match.players[i].socketId] && match.players[i].alive )
					io.sockets.sockets[match.players[i].socketId].emit( "endRound", actions );
			};
		}
		else
		{
			console.log("match is empty");
			this.matches[matchId] = undefined;
		}
	}
};

var server = new Server();
server.start();