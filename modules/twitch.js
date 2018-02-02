const TwitchWebhook = require("twitch-webhook")
const https = require("https")
const assert = require("assert")

const twitch_client_id = global.settings.twitch_id
const twitch_secret = global.settings.twitch_secret

const twitchWebhook = new TwitchWebhook({
    client_id: twitch_client_id,
    callback: 'http://alice.gensokyo.eu:8443/twitch',
    callback: twitch_callback,
    secret: twitch_secret
})

// renew the subscription when it expires
twitchWebhook.on('unsubscribe', (obj) => { 
    twitchWebhook.subscribe(obj['hub.topic'])
})


let event_cache = []
twitchWebhook.on("streams", ({event}) => {
    // Useful shadowing
    let event = event.data[0]

    // Messages can sometimes be received two times. We need to check the ID so that it doesn't happen.
    if (events_cache.includes(event.id)) return
    // Make sure we empty the event cache sometimes, 1 minute after the last event seems like a good idea
    if (event_cache.timeout) clearTimeout(event_cache.timeout)
    event_cache.timeout = setTimeout( () => event_cache = [], 60 * 1000)

    // Message is valid, we can interpret it
    let streamer_id = event.user_id
    let streamer = streamer_cache[streamer_id]
    let channel = cache[streamer.guild].announce_channel

    // If the channel is invalid, look into the cache and try to get it
    if (!channel) {
        // TODO
    }

    channel.send(`${streamer.name} is now live!`)
})

process.on('exit', () => {
    // unsubscribe from all topics
    twitchWebhook.unsubscribe('*')
})

let cache = {}
let streamer_cache = {}

let twitch_db = global.db.collection("twitch_module")

twitch_db.find().toArray( (err, items) => {
    assert.equal(null, err)

    items.forEach( (guild) => {
        cache[guild._id] = guild
        cache[guild._id].announce_channel = global.client.channels.get(guild.announce_channel)
        if (!cache[guild._id].announce_channel) {
            return
        }
        guild.streamers.forEach( (streamer) => {
            twitchWebhook.subscribe("streams", {
                user_id: streamer.id
            })
            streamer_cache[streamer].guild = guild
            streamer_cache[streamer].name = streamer.name
        })
    })
})

exports.id = 11000
exports.commands = {
    "twsetannounce": {
        id: 1,
        description: "Set the channel where lives will be announced",
        callback: async function (message) {
            await twitch_db.save({"_id": message.guild.id}, {"announce_channel": message.channel.id})
            if (!cache[message.guild.id]) cache[message.guild.id] = {}
            cache[message.guild.id].announce_channel = message.channel
            message.channel.send("Channel successfully set as announce channel !")
        }
    },
    "twadd": {
        id: 2,
        description: "Notify when this streamer goes live",
        callback: async function (message, content) {
            let streamer = content.split(" ").shift()
            if (streamer == "") {
                message.channel.send("You need to specify a streamer's name !")
                return
            }
            let data = await get_users_by_name([streamer])
            if (data.data.length == 0) {
                message.channel.send("I can't find this streamer...")
                return
            }
            let streamer_id = data.data[0].id

            await twitch_db.save({"_id": message.guild.id}, { $push: {"streamers": {id: streamer_id, name: streamer}}})
            if (cache[message.guild.id].streamers) cache[message.guild.id].streamers.push(streamer_id)
            else cache[message.guild.id].streamers = [streamer_id]

            // Remember that messages to this streamer go to this server's announce channel
            streamer_cache[streamer_id].guild = message.guild.id
            streamer_cache[streamer_id] = {
                guild: message.guild.id,
                name: streamer
            }
            
            // Subscribe to channel
            twitchWebhook.subscribe("streams", {
                user_id: streamer_id
            })

            message.channel.send(`I'm successfully monitoring ${streamer}'s channel !`)
        }
    },
    "twdel": {
        id: 3,
        description: "Stop notifying when this streamer goes live",
        callback: async function (message, content) {
            let streamer = content.split(" ").shift()
            if (streamer == "") {
                message.channel.send("You need to specify a streamer's name !")
                return
            }
            let data = await get_users_by_name([streamer])
            if (data.length == 0) {
                message.channel.send("I can't find this streamer...")
                return
            }
            let streamer_id = data[0].id

            await twitch_db.save({"_id": message.guild.id}, { $push: {"streamers": streamer_id}})
            if (cache[message.guild.id].streamers) cache[message.guild.id].streamers = cache[message.guild.id].streamers.filter((streamer) => streamer.id != streamer_id && streamer.name != streamer)
            else cache[message.guild.id].streamers = null

            // Remove this streamer from streamer_cache
            delete streamer_cache[streamer_id]
            
            // Subscribe to channel
            twitchWebhook.unsubscribe("streams", {
                user_id: streamer_id
            })

            message.channel.send(`I've successfully stopped monitoring ${streamer}'s channel !`)
        }
    }
}


exports.permission = [global.permissions.module.guild_only, global.default_permission.bind(null, exports.name)]

exports.name = "twitch"
exports.description = "Provides Twitch integration (live notifications)"

function get_users_by_name(usernames) {
    return new Promise ( (resolve, reject) => {
        var data = ""
        let req = https.request({
            hostname: "api.twitch.tv",
            path: "/helix/users?login=" + usernames.join("&login="),
            headers: {
                "Client-Id": twitch_client_id
            }
        }, (res) => {
            res.on("data", (chunk) => data += chunk)
            res.on("end", () => resolve(JSON.parse(data)))
        })
        req.on("error", (err) => reject(err))
        req.end()
    })
}
