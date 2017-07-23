// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    self.F = self.F || {};
    const ns = F.foundation = {};

    const server_url = 'https://textsecure.forsta.services';
    const server_port = 443;
    const attachments_url = 'https://forsta-relay.s3.amazonaws.com';

    let _messageReceiver;
    ns.getMessageReceiver = () => _messageReceiver;

    let _messageSender;
    ns.getMessageSender = () => _messageSender;

    ns.groupSyncRequest = async function() {
        console.assert(_messageSender);
        console.assert(_messageReceiver);
        return await _messageSender.sendRequestGroupSyncMessage();
    };

    ns.getSocketStatus = function() {
        if (_messageReceiver) {
            return _messageReceiver.getStatus();
        } else {
            return -1;
        }
    };

    let _conversations;
    ns.getConversations = function() {
        if (!_conversations) {
            _conversations = new F.ConversationCollection();
        }
        return _conversations;
    };

    let _users;
    ns.getUsers = function() {
        if (!_users) {
            _users = new F.UserCollection();
        }
        return _users;
    };

    let _tags;
    ns.getTags = function() {
        if (!_tags) {
            _tags = new F.TagCollection();
        }
        return _tags;
    };

    let _accountManager;
    ns.getAccountManager = async function() {
        if (_accountManager) {
            return _accountManager;
        }
        const username = await F.state.get('addrId');
        const password = await F.state.get('password');
        const accountManager = new textsecure.AccountManager(server_url,
            server_port, username, password);
        accountManager.addEventListener('registration', async function() {
            await F.state.put('registered', true);
        });
        _accountManager = accountManager;
        return accountManager;
    };

    ns.makeTextSecureServer = async function() {
        const state = await F.state.getDict(['addrId', 'password',
            'signalingKey', 'addr', 'deviceId']);
        return new textsecure.TextSecureServer(server_url, server_port,
            state.addrId, state.password, state.addr, state.deviceId,
            attachments_url);
    };

    async function refreshDataBackgroundTask() {
        let retry_backoff = 1;
        const normal_refresh = 300;
        let wait = normal_refresh;
        while (wait) {
            const jitter = Math.random() * 0.40 + .80;
            await F.util.sleep(jitter * wait);
            console.info("Refreshing foundation data in background...");
            try {
                await ns.fetchData();
                retry_backoff = 1;
                wait = normal_refresh;
            } catch(e) {
                console.error("Failed to refresh foundation data:", e);
                retry_backoff *= 2;
                wait = retry_backoff;
            }
        }
    }

    ns.fetchData = async function() {
        await Promise.all([
            ns.getUsers().fetch(),
            ns.getTags().fetch(),
            ns.getConversations().fetchOrdered()
        ]);
        await ns.groupSyncRequest();
    };

    ns.initApp = async function() {
        if (!(await F.state.get('registered'))) {
            throw new Error('Not Registered');
        }
        if (_messageReceiver || _messageSender) {
            throw new Error("Already initialized");
        }
        await textsecure.init(new F.TextSecureStore());
        const ts = await ns.makeTextSecureServer();
        const signalingKey = await F.state.get('signalingKey');
        _messageReceiver = new textsecure.MessageReceiver(ts, signalingKey);
        _messageReceiver.addEventListener('message', onMessageReceived);
        _messageReceiver.addEventListener('receipt', onDeliveryReceipt);
        _messageReceiver.addEventListener('group', onGroupReceived);
        _messageReceiver.addEventListener('sent', onSentMessage);
        _messageReceiver.addEventListener('read', onReadReceipt);
        _messageReceiver.addEventListener('error', onError);
        _messageReceiver.addEventListener('groupSyncRequest', onGroupSyncRequest);
        _messageSender = new textsecure.MessageSender(ts);
        await this.fetchData();
        refreshDataBackgroundTask();
    };

    ns.initInstaller = async function() {
        if (_messageReceiver || _messageSender) {
            throw new Error("Already initialized");
        }
        await textsecure.init(new F.TextSecureStore());
        const ts = await ns.makeTextSecureServer();
        const signalingKey = await F.state.get('signalingKey');
        _messageReceiver = new textsecure.MessageReceiver(ts, signalingKey);
        _messageReceiver.addEventListener('group', onGroupReceived);
        _messageReceiver.addEventListener('error', onError.bind(this, /*retry*/ false));
        _messageSender = new textsecure.MessageSender(ts);
        await this.fetchData();
    };

    async function onGroupSyncRequest(ev) {
        /* One of our devices needs a hand. */
        const groups = [];
        const extra = [];
        for (const c of _conversations.models) {
            if (!c.isPrivate() && !c.left) {
                groups.push({
                    name: c.get('name'),
                    id: c.id,
                    members: await textsecure.store.getGroupAddrs(c.id)
                });
                // NOTE: Only used by web clients..
                extra.push(c.attributes);
            }
        }
        await _messageSender.sendGroups(groups, extra);
    }

    async function onGroupReceived(ev) {
        const groupDetails = ev.groupDetails;
        if (!groupDetails.active) {
            return;
        }
        const attributes = {
            id: groupDetails.id,
            name: groupDetails.name,
            recipients: groupDetails.members,
            avatar: groupDetails.avatar,
            type: 'group',
        };
        await _conversations.make(attributes);
    }

    async function onMessageReceived(ev) {
        const data = ev.data;
        const message = initIncomingMessage(data.source, data.sourceDevice, data.timestamp);
        await message.handleDataMessage(data.message);
    }

    async function onSentMessage(ev) {
        const data = ev.data;
        const message = new F.Message({
            source: data.source,
            sourceDevice: data.sourceDevice,
            destination: data.destination,
            sent_at: data.timestamp,
            received_at: Date.now(),
            type: 'outgoing',
            sent: true,
            expirationStartTimestamp: data.expirationStartTimestamp,
        });
        await message.handleDataMessage(data.message);
    }

    function initIncomingMessage(source, sourceDevice, timestamp) {
        return new F.Message({
            source,
            sourceDevice,
            sent_at: timestamp,
            received_at: Date.now(),
            type: 'incoming',
            unread: 1
        });
    }

    async function onError(ev) {
        const error = ev.error;
        if (error.name === 'HTTPError' && (error.code == 401 || error.code == 403)) {
            console.warn("Server claims we are not registered!");
            await F.state.put('registered', false);
            location.replace(F.urls.install);
        } else if (error.name === 'HTTPError' && error.code == -1) {
            // Failed to connect to server
            console.warn("Connection Problem");
            _messageReceiver.close();
            _messageReceiver = null;
            _messageSender = null;
            if (navigator.onLine) {
                console.info('Retrying in 30 seconds...');
                setTimeout(ns.initApp, 30000);
            } else {
                console.warn("Waiting for browser to come back online...");
                addEventListener('online', ns.initApp, {once: true});
            }
        } else if (ev.proto) {
            if (error.name === 'MessageCounterError') {
                // Ignore this message. It is likely a duplicate delivery
                // because the server lost our ack the first time.
                return;
            }
            const message = initIncomingMessage(ev.proto.source, ev.proto.sourcDevice,
                                                ev.proto.timestamp.toNumber());
            await message.saveErrors(error);
            const convo = await _conversations.findOrCreate(message);
            convo.set({
                unreadCount: convo.get('unreadCount') + 1
            });
            const cts = convo.get('timestamp');
            const mts = message.get('timestamp');
            if (!cts || mts > cts) {
                convo.set({timestamp: message.get('sent_at')});
            }
            await convo.save();
            convo.addMessage(message);
        } else {
            throw error;
        }
    }

    function onReadReceipt(ev) {
        F.readReceiptQueue.add({
            sent_at: ev.read.timestamp,
            sender: ev.read.sender,
            sourceDevice: ev.read.sourceDevice,
            read_at: ev.timestamp
        });
    }

    function onDeliveryReceipt(ev) {
        const sync = ev.proto;
        F.deliveryReceiptQueue.add({
            sent_at: sync.timestamp.toNumber(),
            source: sync.source,
            sourceDevice: sync.sourceDevice
        });
    }
})();
