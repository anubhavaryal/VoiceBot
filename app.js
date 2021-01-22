require('dotenv').config();

const fs = require('fs');
const Discord = require('discord.js');
const client = new Discord.Client();

client.on('ready', () => {
    console.log("Bot is ready.");
});

// whenever bot sees message sent
client.on('message', async message => {
    console.log("Received message: " + message.content);

    if(message.content.startsWith(process.env.PREFIX) && !message.author.bot) {
        let command = message.content.substring(process.env.PREFIX.length); // remove prefix from command
        let member = message.member; // user who sent the command

        if(command === "join" && member.guild) {
            // make sure that user is in a voice channel
            if(member.voice.channel) {
                const connection = await member.voice.channel.join();

                // whenever user changes speaking state
                connection.on('speaking', (user, speaking) => {
                    // make sure that the user is speaking (bitrate has to be higher than 0)
                    if(speaking.bitfield > 0) {
                        // write audio to temp file
                        const audio = connection.receiver.createStream(user, {mode: 'pcm'});
                        audio.pipe(fs.createWriteStream("./temp/audio"));
                    }
                });

                
                
            } else {
                message.channel.send("You must be in a voice channel to use that command.");
            }
        }
        
        
        
        if(command === "play") {
            console.log("gonna start to play audio");
            const connection = await member.voice.channel.join();
            connection.play(fs.createReadStream("./temp/audio"));
            console.log("finished playing audio");
        }
    }
});

// bot login
client.login(process.env.TOKEN);
