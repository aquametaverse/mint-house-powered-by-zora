/**
 * services/ipfsService.js
 * Handles interactions with IPFS (uploading files and metadata).
 * Choose ONE implementation (e.g., ipfs-http-client OR Pinata SDK).
 */
const fs = require('fs'); // Needed for Pinata stream example

// --- Option 1: Using ipfs-http-client ---
/*
const { create } = require('ipfs-http-client');

// Configure connection to your IPFS node (local or remote like Infura/Pinata)
// Use environment variables for security and flexibility.
const ipfsApiUrl = process.env.IPFS_API_URL;
if (!ipfsApiUrl) {
    console.warn("IPFS_API_URL environment variable not set. IPFS uploads will likely fail.");
}
// Add authorization header if needed (e.g., for Infura IPFS)
const ipfsAuthHeader = process.env.IPFS_AUTH_HEADER; // e.g., 'Basic BASE64_ENCODED_PROJECTID:PROJECT_SECRET'
const ipfsOptions = { url: ipfsApiUrl };
if (ipfsAuthHeader) {
    ipfsOptions.headers = { authorization: ipfsAuthHeader };
}

let ipfs;
try {
    if (ipfsApiUrl) {
         ipfs = create(ipfsOptions);
         console.log(`IPFS client configured for ${ipfsApiUrl}`);
    } else {
         throw new Error("IPFS_API_URL not set.");
    }
} catch (error) {
    console.error("Failed to create IPFS client:", error);
    // Set ipfs to null or a mock object to prevent crashes later,
    // but uploads will fail.
    ipfs = null;
}


async function uploadToIPFS(dataBuffer) {
    if (!ipfs) {
         console.error("IPFS client not initialized. Cannot upload.");
         return null;
    }
    try {
        console.log(`Uploading buffer of size ${dataBuffer.length} to IPFS...`);
        const result = await ipfs.add(dataBuffer, {
            pin: true, // Request pinning
            cidVersion: 1, // Use CID v1 for broader compatibility
        });
        console.log('IPFS Upload Result:', result);
        if (!result || !result.cid) {
            throw new Error('IPFS add operation did not return a valid CID.');
        }
        return result.cid.toString();
    } catch (error) {
        console.error('IPFS upload error:', error);
        // Log more details if possible (e.g., error.message, error.stack)
        return null; // Indicate failure
    }
}

module.exports = { uploadToIPFS };
*/

// --- Option 2: Using Pinata SDK ---

const pinataSDK = require('@pinata/sdk');
const stream = require('stream');

const pinataApiKey = process.env.PINATA_API_KEY;
const pinataSecretApiKey = process.env.PINATA_SECRET_KEY;

if (!pinataApiKey || !pinataSecretApiKey) {
    console.warn("Pinata API Key or Secret not set in environment variables. Pinata uploads will fail.");
}

let pinata = null;
if (pinataApiKey && pinataSecretApiKey) {
    try {
        pinata = pinataSDK(pinataApiKey, pinataSecretApiKey);
        console.log("Pinata SDK initialized.");
    } catch (error) {
        console.error("Failed to initialize Pinata SDK:", error);
    }
}

async function uploadToIPFS(dataBuffer, fileName = `MintHouseUpload_${Date.now()}`) {
    if (!pinata) {
        console.error("Pinata SDK not initialized. Cannot upload.");
        return null;
    }
    try {
        console.log(`Uploading buffer of size ${dataBuffer.length} to Pinata (filename: ${fileName})...`);

        // Convert buffer to readable stream for Pinata SDK
        const readableStream = new stream.PassThrough();
        readableStream.end(dataBuffer);

        const options = {
            pinataMetadata: {
                name: fileName, // Use original filename or a generated one
                // keyvalues: { customKey: 'customValue' } // Optional key-values
            },
            pinataOptions: {
                cidVersion: 1 // Use CID v1
            }
        };

        // Pin the file
        const result = await pinata.pinFileToIPFS(readableStream, options);
        console.log('Pinata Upload Result:', result);

        if (!result || !result.IpfsHash) {
            throw new Error('Pinata pinFileToIPFS operation did not return IpfsHash.');
        }
        return result.IpfsHash; // This is the CID

    } catch (error) {
        console.error('Pinata upload error:', error);
         // Check for specific Pinata errors if possible
        if (error.response && error.response.data) {
             console.error('Pinata API Error Details:', error.response.data);
        }
        return null; // Indicate failure
    }
}

// Test Pinata connection (optional)
/*
if (pinata) {
    pinata.testAuthentication().then((result) => {
        console.log("Pinata authentication successful:", result);
    }).catch((err) => {
        console.error("Pinata authentication failed:", err);
    });
}
*/

module.exports = { uploadToIPFS };

