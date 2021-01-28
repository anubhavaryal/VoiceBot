# VoiceBot
A bot for Discord that can use voice commands in addition to text commands.

## Installation
- Either clone or download the repository to your computer and open the files using a text editor.
- Open a terminal in the project folder and type `npm install` to install all dependencies.
- If you are self-hosting the bot, create a file named `.env`.
    - Put the following text inside the `.env` file.
    ```
    # Discord Variables
    DISCORD_TOKEN=<DISCORD_TOKEN>
    BOT_NAME=<BOT_NAME>
    TEXT_PREFIX=<TEXT_PREFIX>
    VOICE_PREFIX=<VOICE_PREFIX>
    MIN_LENGTH=<MIN_LENGTH>
    MAX_LENGTH=<MAX_LENGTH>

    # Google Variables
    GOOGLE_CREDENTIALS=<GOOGLE_CREDENTIALS>
    FIREBASE_CONFIG=<FIREBASE_CONFIG>
    ```

### Discord Application
- Create a [Discord application](https://discord.com/developers/applications) and replace `<DISCORD_TOKEN>` with your bot's token.
- Replace `<BOT_NAME>` with the name of your bot.
- Replace `<TEXT_PREFIX>` with the text prefix of your choice. This prefix will go before every text command, so make sure it is unique so that it doesn't interfere with other bots.
- Replace `<VOICE_PREFIX>` with the voice prefix of your choice. This prefix will go before every voice command.
- Replace `<MIN_LENGTH>` with the minimum length a voice command can be to be transcribed with Google Speech to Text.
- Replace `<MAX_LENGTH>` with the maximum length a voice command can be to be transcribed with Google Speech to Text.

### Google Cloud Platform
- Create a [new project](https://console.cloud.google.com/) in Google Cloud Platform.
- Go to APIs & Services.
    - Enable Cloud Speech-to-Text API.
    - Enable YouTube Data API v3.
- Create a service account.
- Download the private key as a JSON.
- Replace `<GOOGLE_CREDENTIALS>` with the JSON in the file.
    - Remove newlines as the JSON must be in a single line.

### Firebase
- Create a [Firebase](https://firebase.google.com/) Web app.
- Create a Realtime Database.
- Go to Project Settings and copy the config JSON.
- Replace `<FIREBASE_CONFIG>` with the JSON.
    - Remove newlines as the JSON must be in a single line.
    - Surround all of the keys in quotes.

### Example .env File
If you are self-hosting, your `.env` file should look similar to this.
```
# Discord Variables
DISCORD_TOKEN=VeRY.REal.ToKEn
BOT_NAME=VoiceBot
TEXT_PREFIX=..
VOICE_PREFIX=voice bot
MIN_LENGTH=1
MAX_LENGTH=5

# Google Variables
GOOGLE_CREDENTIALS={"type": "service_account","project_id": "project-id","private_key_id": "private-key","client_email": "voicebot@voicebot.com","client_id": "0123456789","auth_uri": "https://accounts.google.com/o/oauth2/auth","token_uri": "https://oauth2.googleapis.com/token","auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url": "https://www.realurl.com"}
FIREBASE_CONFIG={"apiKey": "rEaLaPIkeY","authDomain": "project.firebaseapp.com","databaseURL": "https://realdatabaseurl.com","projectId": "project-id","storageBucket": "project.appspot.com","messagingSenderId": "9876543210","appId": "123890123890123809","measurementId": "M-EASUREMENT"}
```

### Run Bot
To run the bot, open a terminal in the project and type `npm .`.
- If you receive any errors announcing there are missing environment variables, you have to add the specified variables to the `.env` file.

To receive more information about commands, mention the bot (@ the bot) in the chat, and the bot will reply.

# Hosting
If you do not want to self-host the bot and host somewhere else such as [Heroku](https://dashboard.heroku.com/apps), set the environment variables with keys/values from the `.env` file then delete the file. If you keep the `.env` file, the bot may pull the environment variable values from the file rather than the environment variables you have specified.

# Miscellaneous
If you would like to change the intro sound that plays whenever the bot joins a voice channel, add the audio file to the `/res` folder and rename it to `intro.mp3`.