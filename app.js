require('dotenv').config();

const path = require('path');
const fs = require('fs');

const ffmpeg = require('fluent-ffmpeg');
const ytdl = require('ytdl-core');

const Discord = require('discord.js');
const discordClient = new Discord.Client();

const {google} = require('googleapis');
const {JWTInput} = require('google-auth-library');
const speech = require('@google-cloud/speech');
const firebase = require('firebase/app');
require('firebase/database');

// checks all environment variables and makes sure that all of them are there
function checkEnv() {
    let missingVariables = [];

    if(process.env.DISCORD_TOKEN === undefined) {
        missingVariables.push("DISCORD_TOKEN");
    }

    if(process.env.BOT_NAME === undefined) {
        missingVariables.push("BOT_NAME");
    }

    if(process.env.TEXT_PREFIX === undefined) {
        missingVariables.push("TEXT_PREFIX");
    }

    if(process.env.VOICE_PREFIX === undefined) {
        missingVariables.push("VOICE_PREFIX");
    }

    if(process.env.MIN_LENGTH === undefined) {
        missingVariables.push("MIN_LENGTH");
    }

    if(process.env.MAX_LENGTH === undefined) {
        missingVariables.push("MAX_LENGTH");
    }

    if(process.env.GOOGLE_CREDENTIALS === undefined) {
        missingVariables.push("GOOGLE_CREDENTIALS");
    }

    if(process.env.FIREBASE_CONFIG === undefined) {
        missingVariables.push("FIREBASE_CONFIG");
    }

    for(missingVariable of missingVariables) {
        console.log(`Error: ${missingVariable} is undefined in environment variables.`);
    }

    // exit the program if some environment variables are missing
    if(missingVariables.length > 0) {
        process.exit(1);
    }
}

checkEnv();

// authenticate speech using credentials specified in environment variables
const googleCredentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
const speechClient = new speech.SpeechClient({
    credentials: {
        client_email: googleCredentials.client_email,
        private_key: googleCredentials.private_key
    },
    projectId: googleCredentials.project_id
});

const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
const youtube = google.youtube({version: "v3", auth: firebaseConfig.apiKey});

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

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
    let stop = {stop: false}; // used by playVideos() to check if user asked to stop audio

    // increment the users message count
    updateMessageCount(server, user);

    // check if bot was mentioned
    if(message.mentions.users.array().find(user => user === discordClient.user) != undefined) {
        message.channel.send(`To see a list of commands, type \`${process.env.TEXT_PREFIX}help\`.`);
    }

    // check if the message is a command
    if(content.startsWith(process.env.TEXT_PREFIX)) {
        const channel = message.channel;
        const commandArguments = content.substring(process.env.TEXT_PREFIX.length).split(" "); // stores the command (removes prefix)
        
        if(commandArguments[0] === "help") {
            sendHelpMessage(user, discordClient);
        } else if(commandArguments[0] === "join") {
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
                                
                                console.log(`Transcript: ${transcript}`);

                                if(transcript.startsWith(process.env.VOICE_PREFIX)) {
                                    const voiceCommand = transcript.substring(process.env.VOICE_PREFIX.length).trim().toLowerCase().split(" ");
                                    console.log(`Voice command detected: ${voiceCommand}`);

                                    if(voiceCommand[0] === "help") {
                                        sendHelpMessage(user, discordClient);
                                    } else if(voiceCommand[0] === "leave") {
                                        // leave the channel
                                        server.me.voice.channel.leave();
                                    } else if(voiceCommand[0] === "say") {
                                        // enters whatever the user said to the chat
                                        channel.send(voiceCommand.slice(1).join(" "));
                                    } else if(voiceCommand[0] === "playlist") {
                                        const playlistName = voiceCommand[2] ?? "default";

                                        if(voiceCommand[1] === "create") {
                                            await createPlaylist(server, playlistName);
                                        } else if(voiceCommand[1] === "delete") {
                                            await deletePlaylist(server, playlistName);
                                        } else if(voiceCommand[1] === "add") {
                                            await getYoutubeLink(voiceCommand.slice(3).join(" ")).then(result => {
                                                const videoLink = `https://www.youtube.com/watch?v=${result.data.items[0].id.videoId}`;
                                                addToPlaylist(server, playlistName, videoLink);
                                            });
                                        } else if(voiceCommand[1] === "remove") {
                                            await getYoutubeLink(voiceCommand.slice(3).join(" ")).then(result => {
                                                const videoLink = `https://www.youtube.com/watch?v=${result.data.items[0].id.videoId}`;
                                                removeFromPlaylist(server, playlistName, videoLink);
                                            });
                                        } else if(voiceCommand[1] === "play") {
                                            await playPlaylist(server, playlistName, stop);
                                        }
                                    }
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
        } else if(commandArguments[0] === "leave") {
            const userChannel = member.voice.channel;
            const botChannel = server.me.voice.channel;

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
        } else if(commandArguments[0] === "playlist") {
            const playlistName = commandArguments[2] ?? "default";

            if(commandArguments[1] === "create") {
                await createPlaylist(server, playlistName);
            } else if(commandArguments[1] === "delete") {
                await deletePlaylist(server, playlistName);
            } else if(commandArguments[1] === "add") {
                if(commandArguments[3] != undefined) {
                    if(commandArguments[3].startsWith("https://www.youtube.com")) {
                        addToPlaylist(server, playlistName, commandArguments[3]);
                    } else {
                        await getYoutubeLink(commandArguments.slice(3).join(" ")).then(result => {
                            const videoLink = `https://www.youtube.com/watch?v=${result.data.items[0].id.videoId}`;
                            addToPlaylist(server, playlistName, videoLink);
                        });
                    }
                }
            } else if(commandArguments[1] === "remove") {
                if(commandArguments[3] != undefined) {
                    if(commandArguments[3].startsWith("https://www.youtube.com")) {
                        removeFromPlaylist(server, playlistName, commandArguments[3]);
                    } else {
                        await getYoutubeLink(commandArguments.slice(3).join(" ")).then(result => {
                            const videoLink = `https://www.youtube.com/watch?v=${result.data.items[0].id.videoId}`;
                            removeFromPlaylist(server, playlistName, videoLink);
                        });
                    }
                }
            } else if(commandArguments[1] === "play") {
                await playPlaylist(server, playlistName, stop);
            } else if(commandArguments[1] === "stop") {
                await stopPlaylist(server, stop);
            } else if(commandArguments[1] === "show") {
                await showPlaylist(server, playlistName, channel);
            } else if(commandArguments[1] === "all") {
                await showAllPlaylists(server, channel);
            }
        }
    }
});

// creates an embed with help information and sends it to user
async function sendHelpMessage(user, client) {
    // create an embed with help information
    const helpEmbed = new Discord.MessageEmbed()
    .setTitle("Commands")
    .setDescription("**(Required)**\nArguments surrounded by parantheses are required.\n\n**[Optional]**\nArguments surrounded by square brackets are optional.\n\n**Argument1|Argument2**\nArguments separated by a pipe means you can either choose Argument1 or Argument2 but not both.\n\nList of bot commands.")
    .setColor([0, 127, 255])
    .addField(`${process.env.TEXT_PREFIX}help / "${process.env.VOICE_PREFIX} help"`, "Sends this message.")
    .addField(`${process.env.TEXT_PREFIX}join`, "Bot joins the voice channel you are currently in. The user must be in a voice channel for this to work.")
    .addField(`${process.env.TEXT_PREFIX}leave / "${process.env.VOICE_PREFIX} leave"`, "Bot leaves the voice channel you are currently in. The user and the bot must be in the same voice channel for this to work.")
    .addField(`${process.env.TEXT_PREFIX}playlist create [playlistName] / "${process.env.VOICE_PREFIX} playlist create [playlistName]"`, "Creates a playlist with the specified name (or name \"default\" if no name was specified).")
    .addField(`${process.env.TEXT_PREFIX}playlist delete [playlistName] / "${process.env.VOICE_PREFIX} playlist delete [playlistName]"`, "Deletes the playlist with the specified name (or name \"default\" if no name was specified).")
    .addField(`${process.env.TEXT_PREFIX}playlist add (playlistName) (videoLink)|(videoKeyword) / "${process.env.VOICE_PREFIX} playlist add (playlistName) (videoKeyword)"`, "Adds the specified video link/keyword to the specified playlist. Links must start with \"https://www.youtube.com.\" If a keyword is entered instead of a link, the most relevant search result will be used.")
    .addField(`${process.env.TEXT_PREFIX}playlist remove (playlistName) (videoLink)|(videoKeyword) / "${process.env.VOICE_PREFIX} playlist remove (playlistName) (videoKeyword)"`, "Removes the specified video link/keyword from the specified playlist. Links must start with \"https://www.youtube.com.\" If a keyword is entered instead of a link, the most relevant search result will be used.")
    .addField(`${process.env.TEXT_PREFIX}playlist play [playlistName] / "${process.env.VOICE_PREFIX} playlist play [playlistName]"`, "Plays all videos stored in the playlist with the specified name (or name \"default\" if no name was specified).")
    .addField(`${process.env.TEXT_PREFIX}playlist stop`, "Stops the bot from playing all audio. This command cannot be activated with voice due to a limitation with discord.js.")
    .addField(`${process.env.TEXT_PREFIX}playlist show [playlistName]`, "Sends an embed to the server showing the information for the playlist with the specified name (or name \"default\" if no name was specified).")
    .addField(`${process.env.TEXT_PREFIX}playlist all`, "Sends an embed to the server showing all playlists on the server.")
    .setFooter(process.env.BOT_NAME, client.user.avatarURL());
    user.send(helpEmbed);
}

// returns the link of the top search result on youtube
async function getYoutubeLink(search) {
    return await youtube.search.list({
        part: 'snippet',
        q: search,
        maxResults: 1
    });
}

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
            phrases: [process.env.VOICE_PREFIX]
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
    let userRef = database.ref(`servers/${server.id}/users/${user.id}`);

    // iterate through all of the data snapshots in the reference
    userRef.once('value', snapshot => {
        let messageChanged = false;

        snapshot.forEach(child => {
            if(child.key === "messageCount") {
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

// creates an empty playlist in the server
async function createPlaylist(server, playlistName) {
    let playlistRef = database.ref(`servers/${server.id}/playlists`);

    // check if the playlist already exists
    let exists = false;

    playlistRef.once('value', snapshot => {
        snapshot.forEach(child => {
            if(child.key === playlistName) {
                exists = true;
            }
        })
    });

    if(!exists) {
        // create description showing when playlist was created
        const currentTime = new Date();
        const day = String(currentTime.getDate()).padStart(2, "0");
        const month = String(currentTime.getMonth() + 1).padStart(2, "0");
        const year = currentTime.getFullYear();
        const hour = String(currentTime.getHours()).padStart(2, "0");
        const minute = String(currentTime.getMinutes()).padStart(2, "0");

        const playlistDescription = `Playlist Created: ${month}/${day}/${year} ${hour}:${minute}`;

        playlistRef.update({
            [playlistName]: [playlistDescription]
        });
    }
}

// deletes the playlist in the server
async function deletePlaylist(server, playlistName) {
    let playlistRef = database.ref(`servers/${server.id}/playlists`);

    playlistRef.once('value', snapshot => {
        snapshot.forEach(child => {
            if(child.key === playlistName) {
                child.ref.remove();
            }
        });
    });
}

// adds the youtube link to the servers playlist
async function addToPlaylist(server, playlistName, videoLink) {
    let playlistRef = database.ref(`servers/${server.id}/playlists`);

    playlistRef.once('value', snapshot => {
        snapshot.forEach(child => {
            if(child.key === playlistName) {
                const val = child.val();
                let playlist = [];

                // recreate playlist array from the object
                Object.keys(val).forEach(key => {
                    playlist = [...playlist, val[key]];
                });

                playlist = [...playlist, videoLink];
                child.ref.set(playlist);
            }
        });
    });
}

// removes the youtube link from the servers playlist
async function removeFromPlaylist(server, playlistName, videoLink) {
    let playlistRef = database.ref(`servers/${server.id}/playlists`);

    playlistRef.once('value', snapshot => {
        snapshot.forEach(child => {
            if(child.key === playlistName) {
                const val = child.val();
                let playlist = [];

                Object.keys(val).forEach(key => {
                    playlist = [...playlist, val[key]];
                });

                // remove all instances of video link in the playlist
                playlist = playlist.filter(link => link !== videoLink);
                child.ref.set(playlist);
            }
        });
    });
}

// plays all the links in the servers playlist 
async function playPlaylist(server, playlistName, stop) {
    stop.stop = false; // stop stop if stopped
    let playlistRef = database.ref(`servers/${server.id}/playlists`);

    playlistRef.once('value', snapshot => {
        snapshot.forEach(child => {
            if(child.key === playlistName) {
                const val = child.val();
                let playlist = [];

                Object.keys(val).forEach(key => {
                    playlist = [...playlist, val[key]];
                });

                playlist.shift(); // first element in playlist is always description
                playVideos(server, playlist, stop);
            }
        })
    });
}

// plays the first video specified in the array videoLinks
async function playVideos(server, videoLinks, stop) {
    // make sure videoLinks isn't empty
    if(videoLinks.length !== 0) {
        const voiceConnection = server.me.voice.connection;
        const videoLink = videoLinks.shift();

        const dispatcher = voiceConnection.play(ytdl(videoLink));

        dispatcher.on('speaking', speaking => {
            // check if user asked to stop
            if(!speaking && !stop.stop) {
                // play the next video
                playVideos(server, videoLinks, stop);
            }
        })
    }
}

// stops playing links in servers playlist
async function stopPlaylist(server, stop) {
    // stop playVideos from running if true
    stop.stop = true;

    // make bot play silence (effectively stopping bot from speaking)
    const introFilePath = path.join(__dirname, "res", "silence.mp3");
    server.me.voice.connection.play(introFilePath);
}

// sends an embed to the specified channel displaying playlist information
async function showPlaylist(server, playlistName, channel) {
    let playlistEmbed = new Discord.MessageEmbed(); // embed that will contain playlist information
    let playlistRef = database.ref(`servers/${server.id}/playlists`);

    playlistRef.once('value', snapshot => {
        snapshot.forEach(child => {
            const key = child.key;

            if(key === playlistName) {
                const val = child.val();
                let playlist = [];

                Object.keys(val).forEach(key => {
                    playlist = [...playlist, val[key]];
                });

                const description = playlist.shift();

                playlistEmbed.setTitle(key);
                playlistEmbed.setDescription(description);

                for(let i = 0; i < playlist.length; i++) {
                    playlistEmbed.addField(`#${i + 1}`, playlist[i]);
                }

                channel.send(playlistEmbed);
            }
        })
    });
}

// sends an embed to the specified channel displaying all playlists
async function showAllPlaylists(server, channel) {
    let allPlaylistsEmbed = new Discord.MessageEmbed();
    allPlaylistsEmbed.setTitle(server.name);
    allPlaylistsEmbed.setDescription("All playlists on the server.");

    let playlistRef = database.ref(`servers/${server.id}/playlists`);

    playlistRef.once('value', snapshot => {
        const val = snapshot.val();

        if(val != undefined) {
            Object.keys(val).forEach(key => {
                allPlaylistsEmbed.addField(key, val[key][0]);
            });

            channel.send(allPlaylistsEmbed);
        }
    });
}

// bot login using token
discordClient.login(process.env.DISCORD_TOKEN);