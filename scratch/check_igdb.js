const axios = require('axios');
require('dotenv').config();

async function getAccessToken() {
    const params = new URLSearchParams();
    params.append('client_id', process.env.TWITCH_CLIENT_ID);
    params.append('client_secret', process.env.TWITCH_CLIENT_SECRET);
    params.append('grant_type', 'client_credentials');
    const res = await axios.post('https://id.twitch.tv/oauth2/token', params);
    return res.data.access_token;
}

async function check() {
    const token = await getAccessToken();
    const query = 'fields name, first_release_date, collection.name, franchises.name; where name ~ "Metroid Dread"*;';
    const res = await axios.post('https://api.igdb.com/v4/games', query, {
        headers: {
            'Client-ID': process.env.TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'text/plain'
        }
    });
    console.log(JSON.stringify(res.data, null, 2));
}

check().catch(console.error);
