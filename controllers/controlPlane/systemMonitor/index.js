const axios = require("axios");


async function getLocation() {
  const res = await axios.get("https://ipapi.co/json");

  return {
    latitude: res.data.latitude,
    longitude: res.data.longitude,
    country: res.data.country,
    region: res.data.region
  };
}