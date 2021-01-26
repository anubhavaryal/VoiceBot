require('dotenv').config();

const path = require('path');
const fs = require('fs');

const ffmpeg = require('fluent-ffmpeg');

const Discord = require('discord.js');
const discordClient = new Discord.Client();

const {JWTInput} = require('google-auth-library');
const speech = require('@google-cloud/speech');
const firebase = require('firebase/app');
const { on } = require('process');
require('firebase/database');

const googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const speechClient = new speech.SpeechClient({
    credentials: {
        client_email: googleCredentials.client_email,
        private_key: googleCredentials.private_key
    },
    projectId: googleCredentials.project_id
});

const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// checks .env file to make sure all necessary variables are there
function checkEnv() {
    if(fs.existsSync('/.env')) {
        console.log("Error: .env file not found.");
        process.exit(1);
    }

    let safe = true;

    if(process.env.DISCORD_TOKEN === undefined) {
        console.log("Error: DISCORD_TOKEN is undefined in .env file.");
        safe = false;
    }

    if(process.env.TEXT_PREFIX === undefined) {
        console.log("Error: TEXT_PREFIX is undefined in .env file.");
        safe = false;
    }

    if(process.env.VOICE_PREFIX === undefined) {
        console.log("Error: VOICE_PREFIX is undefined in .env file.");
        safe = false;
    }

    if(process.env.MAX_LENGTH === undefined) {
        console.log("Error: MAX_LENGTH is undefined in .env file.");
        safe = false;
    }

    if(process.env.GOOGLE_CREDENTIALS === undefined) {
        console.log("Error: GOOGLE_CREDENTIALS is undefined in .env file.");
        safe = false;
    }

    if(process.env.FIREBASE_CONFIG === undefined) {
        console.log("Error: FIREBASE_CONFIG is undefined in .env file.");
        safe = false;
    }

    // exit the program if some variables in .env are missing
    if(!safe) {
        process.exit(1);
    }
}

checkEnv();

discordClient.on('ready', () => {
    console.log("Bot is online.");
});

discordClient.on('message', async message => {
    // return if message was sent by a bot or was a dm
    if(message.author.bot || !message.guild) {
        return;
    }

    let content = message.content;
    let server = message.guild;
    let member = message.member;
    let user = member.user;

    // increment the users message count
    updateMessageCount(server.id, user.id);

    // check if the message is a command
    if(content.startsWith(process.env.TEXT_PREFIX)) {
        const channel = message.channel;
        const command = content.substring(process.env.TEXT_PREFIX.length); // stores the command (removes prefix)
        
        if(command === "help") {
            // create an embed with help information
            const helpEmbed = new Discord.MessageEmbed()
                .setTitle("Commands")
                .setDescription("List of bot commands.")
                .setColor([0, 127, 255])
                .addField(`${process.env.TEXT_PREFIX}help`, "Sends this message.")
                .addField(`${process.env.TEXT_PREFIX}join`, "Bot joins the voice channel you are currently in. The user must be in a voice channel for this to work.")
                .addField(`${process.env.TEXT_PREFIX}leave`, "Bot leaves the voice channel you are currently in. The user and the bot must be in the same voice channel for this to work.")
                .setFooter(process.env.BOT_NAME, discordClient.user.avatarURL());
            user.send(helpEmbed);
        } else if(command === "join") {
            const voiceChannel = member.voice.channel;

            if(voiceChannel != null) {
                let voiceConnection = await voiceChannel.join();

                // audio must be played before any audio can be received
                const introFilePath = path.join(__dirname, "res", "intro.mp3");
                voiceConnection.play(introFilePath);

                voiceConnection.on('speaking', async(user, speaking) => {
                    // make sure user is speaking (bitfield over 0)
                    // and user is not a bot
                    if(speaking.bitfield > 0 && !user.bot) {
                        // create temporary file in audio folder
                        const filePath = path.join(__dirname, "audio", `${user.id}-${Math.floor(Math.random() * 10000)}`);
                        const audio = voiceConnection.receiver.createStream(user, {mode: "pcm"});
                        audio.pipe(fs.createWriteStream(filePath));

                        // once the audio ends
                        audio.on('end', async() => {
                            // discord pcm uses 48kHz, 2 bytes (16 bits), and 2 channels
                            // length = size / (rate * bytes * channels)
                            const length = fs.statSync(filePath).size / 192000;
                            console.log(`Audio Length: ${length}`);

                            if(length <= process.env.MAX_LENGTH && length >= process.env.MIN_LENGTH) {
                                let newFilePath = `${filePath}.flac`;

                                // convert audio to useable format
                                await convertAudio(filePath, newFilePath);

                                // get transcript from audio then delete audio files
                                let transcript = await getAudioTranscript(newFilePath)
                                    .finally(() => {
                                        // delete files once done using them
                                        fs.unlinkSync(filePath);
                                        fs.unlinkSync(newFilePath);
                                    });
                                
                                console.log(transcript);

                                if(transcript.startsWith(process.env.VOICE_PREFIX)) {
                                    const voiceCommand = transcript.substring(process.env.VOICE_PREFIX.length).trim();
                                    console.log(`Voice command detected: ${voiceCommand}`);
                                }
                            } else {
                                console.log(`Audio must be between ${process.env.MIN_LENGTH} and ${process.env.MAX_LENGTH} seconds to process.`);

                                // delete file
                                fs.unlinkSync(filePath);
                            }
                        });
                    }
                });
            } else {
                channel.send(`<@${user.id}> You have to be in a voice channel to use that command.`);
            }
        } else if(command === "leave") {
            const userChannel = member.voice.channel;
            const botChannel = server.voice.connection.channel;

            // check if user and bot are both in a channel
            if(userChannel != null && botChannel != null) {
                // check if user and bot are in the same channel
                if(userChannel === botChannel) {
                    botChannel.leave();
                } else {
                    channel.send(`<@${user.id}> You must be in the same channel as the bot to use that command.`);
                }
            } else {
                channel.send(`<@${user.id}> You and the bot both have to be in a voice channel to use that command.`);
            }
        }
    }
});

// convert 2 channel (stereo) pcm to 1 channel (mono) flac
// synchronous since new file must be created before moving on
function convertAudio(inputFilePath, outputFilePath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputFilePath)
        .addInputOption("-f s16le") // signed 16-bit little endian
        .addInputOption("-ar 48k") // 48kHz sample rate
        .addInputOption("-ac 2") // 2 channels (stereo)
        .addOutputOption("-ac 1") // 1 channel (mono)
        .withAudioCodec("flac") // flac audio codec
        .save(outputFilePath)
        .on('end', () => resolve());
    });
}

// use google speech to text to get the transcript for an audio file
async function getAudioTranscript(filePath) {
    const config = {
        encoding: "FLAC",
        sampleRateHertz: 48000,
        languageCode: "en-US",
        speechContexts: [{
            "phrases": [process.env.VOICE_PREFIX]
        }]
    };

    const audio = {
        content: fs.readFileSync(filePath).toString("base64")
    };

    const request = {
        config: config,
        audio: audio
    };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results
                            .map(result => result.alternatives[0].transcript)
                            .join("\n");
    
    return transcription;
}

// increments the message count of a user in a server by 1
async function updateMessageCount(server, user) {
    console.log("entered updateMessageCount");
    let userRef = database.ref(`servers/${server}/users/${user}`);
    userRef.once('value', snapshot => {
        let messageChanged = false;
        snapshot.forEach(child => {
            const key = child.key;

            if(key === "messageCount") {
                const count = child.val();
                userRef.set({
                    messageCount: count + 1
                });
                messageChanged = true;
            }
        });

        if(!messageChanged) {
            userRef.set({
                messageCount: 1
            });
        }
    });
}

// bot login using token
discordClient.login(process.env.DISCORD_TOKEN);