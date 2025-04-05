/**
 * routes/mintRoutes.js
 * Defines API endpoints related to the NFT creation and minting process.
 */
const express = require('express');
const router = express.Router();
const mintController = require('../controllers/mintController'); // Assuming controller exists
const { ensureAuthenticated } = require('../middleware/auth'); // Your authentication middleware
const upload = require('../middleware/multerConfig'); // Your multer configuration

// === Page Rendering Routes ===

// GET route to display the initial NFT creation form
router.get('/create',
    ensureAuthenticated, // Ensure user is logged in
    mintController.getCreatePage
);

// GET route to display an existing draft for editing/viewing
router.get('/drafts/:id',
    ensureAuthenticated,
    mintController.getDraftPage // Controller needs to fetch draft by ID and user
);

// GET route to display the final confirmation page before minting
// This page will show final details and include the gas fee logic
router.get('/confirm-mint/:id',
    ensureAuthenticated,
    mintController.getConfirmMintPage // Controller fetches prepared data
);


// === API / Action Routes ===

// POST route to save a new draft (handles file upload)
router.post('/drafts',
    ensureAuthenticated,
    upload.single('nftFile'), // Middleware to handle single file upload named 'nftFile'
    mintController.saveDraft // Controller saves metadata and file info to DB
);

// PUT route to update an existing draft (handles file upload if changed)
router.put('/drafts/:id',
    ensureAuthenticated,
    upload.single('nftFile'), // Handle potential file replacement
    mintController.updateDraft // Controller finds and updates the draft
);

// POST route to initiate the mint preparation process (IPFS uploads, Zora data prep)
// Takes a draft ID
router.post('/prepare-mint/:id',
    ensureAuthenticated,
    mintController.prepareMint // Controller handles IPFS uploads and Zora fee/param estimation
);

// GET route for the frontend to poll for current gas price estimates
router.get('/gas-estimate',
    // No auth needed generally, but rate limiting is advised
    mintController.getGasEstimate
);

// POST route for the frontend to notify the backend after a successful mint transaction
// This updates the status in the database.
router.post('/record-mint/:id',
    ensureAuthenticated,
    mintController.recordMintSuccess // Controller updates DB status, stores txHash, tokenId
);

// DELETE route to delete a draft (optional)
// router.delete('/drafts/:id', ensureAuthenticated, mintController.deleteDraft);


module.exports = router;
