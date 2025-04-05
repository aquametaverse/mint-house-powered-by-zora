/**
 * controllers/mintController.js
 * Handles the business logic for NFT creation routes.
 */
const mongoose = require('mongoose');
const Creation = require('../models/Creation'); // Import the Mongoose model
const ipfsService = require('../services/ipfsService'); // Import your IPFS service
const zoraService = require('../services/zoraService'); // Import your Zora service
const { ethers } = require('ethers'); // Import ethers for utilities
const fs = require('fs').promises; // Use promises for async file operations
const path = require('path'); // For handling file paths

// Configure temporary upload directory (ensure this exists and is writable)
// IMPORTANT: Use environment variables for configuration
const TEMP_UPLOAD_DIR = process.env.TEMP_UPLOAD_DIR || path.join(__dirname, '..', 'temp_uploads');

// Ensure temp directory exists
fs.mkdir(TEMP_UPLOAD_DIR, { recursive: true }).catch(console.error);


// === Page Controllers ===

exports.getCreatePage = (req, res) => {
    // Renders the main creation form (e.g., using EJS, Handlebars, etc.)
    res.render('mint/create-edit', { // Assuming a single template for create/edit
        title: 'Create New NFT Draft',
        draft: null, // No existing draft data for create page
        actionUrl: '/mint/drafts' // Form POST target
    });
};

exports.getDraftPage = async (req, res) => {
    try {
        const draft = await Creation.findOne({ _id: req.params.id, userId: req.user._id }).lean(); // Use lean for plain JS object
        if (!draft) {
            req.flash('error_msg', 'Draft not found or access denied.');
            return res.redirect('/dashboard'); // Or wherever user drafts are listed
        }
        res.render('mint/create-edit', {
            title: 'Edit NFT Draft',
            draft: draft,
            actionUrl: `/mint/drafts/${req.params.id}?_method=PUT` // URL for updating
        });
    } catch (err) {
        console.error("Error loading draft:", err);
        req.flash('error_msg', 'Error loading draft.');
        res.redirect('/dashboard');
    }
};

exports.getConfirmMintPage = async (req, res) => {
     try {
        // Fetch draft data that should be in 'pending_mint' status
        const draft = await Creation.findOne({ _id: req.params.id, userId: req.user._id, status: 'pending_mint' }).lean();
        if (!draft) {
            req.flash('error_msg', 'Minting session not found or invalid state.');
            // Maybe redirect to the draft page if it exists but isn't pending_mint?
            return res.redirect(`/mint/drafts/${req.params.id}`);
        }

        // Fetch initial gas estimate to display
        const initialGas = await zoraService.getGasEstimateData(); // Use a consolidated function

        res.render('mint/confirm', {
            title: 'Confirm Mint Details',
            draft: draft,
            initialGas: initialGas, // Pass initial gas data to the view
            // Pass other necessary data like contract address, ABI snippets if needed by frontend JS
        });
    } catch (err) {
        console.error("Error loading confirmation page:", err);
        req.flash('error_msg', 'Error preparing confirmation page.');
        res.redirect(`/mint/drafts/${req.params.id}`);
    }
};


// === Action Controllers ===

exports.saveDraft = async (req, res) => {
    // Note: Input validation should be done via middleware (e.g., express-validator) before this controller
    try {
        // 1. Parse and Validate Input Data (creatorSplits, commission, tags)
        let creatorSplits = [];
        if (req.body.creatorSplits) {
            try {
                // Ensure secure parsing and validation of structure/types
                creatorSplits = JSON.parse(req.body.creatorSplits).map(split => ({
                    walletAddress: split.walletAddress,
                    sharePercentage: Number(split.sharePercentage)
                }));
                // Add more validation here (addresses valid, percentages numbers, etc.)
            } catch (e) { throw new Error("Invalid creator splits format."); }
        }

        let tags = [];
        if (req.body.tags) {
            tags = req.body.tags.split(',').map(tag => tag.trim().toLowerCase()).filter(t => t);
        }

        const commissionPercentage = Number(req.body.commissionPercentage || 0);
        const referrerAddress = req.body.referrerAddress || ethers.constants.AddressZero;
        if (!ethers.utils.isAddress(referrerAddress)) {
            throw new Error("Invalid referrer address format.");
        }
        if (commissionPercentage < 0 || commissionPercentage > 100) {
             throw new Error("Invalid commission percentage.");
        }

        // 2. Create New Creation Document
        const newCreation = new Creation({
            userId: req.user._id, // Assumes req.user is populated by auth middleware
            title: req.body.title,
            description: req.body.description,
            tags: tags,
            creatorSplits: creatorSplits,
            sellerCommission: {
                referrerAddress: referrerAddress,
                commissionPercentage: commissionPercentage
            },
            status: 'draft',
            // File info will be added next if applicable
        });

        // 3. Handle File Upload (if provided)
        if (req.file) {
            // IMPORTANT: req.file comes from multer. If using diskStorage, req.file.path will be set.
            // If using memoryStorage, req.file.buffer will contain the data.
            // We need to store the file *temporarily* before IPFS upload during 'prepareMint'.
            // Strategy: Save to a temp dir using a unique name (e.g., draft ID + original name).
            const tempFileName = `${newCreation._id}-${req.file.originalname}`;
            const tempFilePath = path.join(TEMP_UPLOAD_DIR, tempFileName);

            // If using memoryStorage:
            if (req.file.buffer) {
                 await fs.writeFile(tempFilePath, req.file.buffer);
            }
            // If using diskStorage, multer already saved it, just need to move/rename?
            // Or better: configure multer to save directly with the unique name.
            // For simplicity here, assume we write the buffer:
            else {
                 // Handle case where multer saved to disk but we need to read/move
                 // This depends heavily on your multer setup. Let's assume buffer for now.
                 throw new Error("Multer setup not configured for buffer or file path handling unclear.");
            }

            newCreation.originalFileName = req.file.originalname;
            newCreation.fileType = req.file.mimetype;
            newCreation.fileSizeBytes = req.file.size;
            // We don't store the temp path in DB, derive it from ID and original name when needed
        } else {
             // Handle case where title/metadata is saved but no file yet
             // Or require file on initial save? Depends on desired UX.
        }

        // 4. Validate and Save to Database
        await newCreation.save(); // Mongoose validation (including splits sum) happens here

        req.flash('success_msg', 'Draft saved successfully!');
        res.redirect(`/mint/drafts/${newCreation._id}`); // Redirect to the edit page for this new draft

    } catch (err) {
        console.error("Error saving draft:", err);
        // Cleanup uploaded temp file if save fails and file exists
        if (req.file) {
             const tempFileName = `${/* Need ID if generated before error */}-${req.file.originalname}`; // Problem: ID might not be set if validation fails early
             const tempFilePath = path.join(TEMP_UPLOAD_DIR, tempFileName);
             fs.unlink(tempFilePath).catch(unlinkErr => console.error("Error cleaning up temp file:", unlinkErr));
        }

        // Handle Mongoose validation errors specifically for better feedback
        if (err.name === 'ValidationError') {
             const messages = Object.values(err.errors).map(val => val.message);
             req.flash('error_msg', `Validation Failed: ${messages.join(', ')}`);
        } else {
             req.flash('error_msg', `Failed to save draft: ${err.message}`);
        }
        // Render the create page again, passing back submitted data and errors
        res.status(400).render('mint/create-edit', {
            title: 'Create New NFT Draft',
            draft: req.body, // Send back submitted data
            errors: req.flash('error_msg'), // Pass errors to the view
            actionUrl: '/mint/drafts'
        });
    }
};

exports.updateDraft = async (req, res) => {
    try {
        const draftId = req.params.id;
        const userId = req.user._id;

        // 1. Find Existing Draft owned by user
        const existingDraft = await Creation.findOne({ _id: draftId, userId: userId });
        if (!existingDraft) {
            req.flash('error_msg', 'Draft not found or access denied.');
            return res.status(404).redirect('/dashboard');
        }
        // Cannot update if already minted or pending
        if (['pending_ipfs', 'pending_mint', 'minted'].includes(existingDraft.status)) {
             req.flash('error_msg', 'Cannot update a draft that is being processed or already minted.');
             return res.status(400).redirect(`/mint/drafts/${draftId}`);
        }

        // 2. Parse and Validate Input Data (similar to saveDraft)
        let creatorSplits = existingDraft.creatorSplits; // Default to existing
        if (req.body.creatorSplits) {
             try {
                 creatorSplits = JSON.parse(req.body.creatorSplits).map(split => ({
                     walletAddress: split.walletAddress,
                     sharePercentage: Number(split.sharePercentage)
                 }));
             } catch (e) { throw new Error("Invalid creator splits format."); }
        }
        // ... validation for splits ...

        let tags = existingDraft.tags;
        if (req.body.tags) {
            tags = req.body.tags.split(',').map(tag => tag.trim().toLowerCase()).filter(t => t);
        }

        const commissionPercentage = Number(req.body.commissionPercentage || existingDraft.sellerCommission?.commissionPercentage || 0);
        const referrerAddress = req.body.referrerAddress || existingDraft.sellerCommission?.referrerAddress || ethers.constants.AddressZero;
         if (!ethers.utils.isAddress(referrerAddress)) {
            throw new Error("Invalid referrer address format.");
        }
        if (commissionPercentage < 0 || commissionPercentage > 100) {
             throw new Error("Invalid commission percentage.");
        }

        // 3. Update Fields
        existingDraft.title = req.body.title || existingDraft.title;
        existingDraft.description = req.body.description || existingDraft.description;
        existingDraft.tags = tags;
        existingDraft.creatorSplits = creatorSplits;
        existingDraft.sellerCommission = { referrerAddress, commissionPercentage };
        existingDraft.status = 'draft'; // Reset status if it was 'error'
        existingDraft.errorMessage = null; // Clear previous error

        // 4. Handle File Update (if new file provided)
        if (req.file) {
            // Delete old temp file if it exists
            const oldTempFileName = `${existingDraft._id}-${existingDraft.originalFileName}`;
            const oldTempFilePath = path.join(TEMP_UPLOAD_DIR, oldTempFileName);
            await fs.unlink(oldTempFilePath).catch(err => console.log("No old temp file to delete or error:", err.code)); // Ignore if not found

            // Save new temp file
            const newTempFileName = `${existingDraft._id}-${req.file.originalname}`;
            const newTempFilePath = path.join(TEMP_UPLOAD_DIR, newTempFileName);
             if (req.file.buffer) {
                 await fs.writeFile(newTempFilePath, req.file.buffer);
            } else { throw new Error("Multer setup not configured for buffer or file path handling unclear."); }

            // Update DB record with new file info
            existingDraft.originalFileName = req.file.originalname;
            existingDraft.fileType = req.file.mimetype;
            existingDraft.fileSizeBytes = req.file.size;
            // Reset IPFS fields as the file changed
            existingDraft.fileCid = null;
            existingDraft.metadataCid = null;
            existingDraft.metadataUri = null;
        }

        // 5. Validate and Save Updated Draft
        await existingDraft.save();

        req.flash('success_msg', 'Draft updated successfully!');
        res.redirect(`/mint/drafts/${existingDraft._id}`);

    } catch (err) {
        console.error("Error updating draft:", err);
         // Cleanup newly uploaded temp file if update fails
        if (req.file) {
             const tempFileName = `${req.params.id}-${req.file.originalname}`;
             const tempFilePath = path.join(TEMP_UPLOAD_DIR, tempFileName);
             fs.unlink(tempFilePath).catch(unlinkErr => console.error("Error cleaning up new temp file on update failure:", unlinkErr));
        }

        if (err.name === 'ValidationError') {
             const messages = Object.values(err.errors).map(val => val.message);
             req.flash('error_msg', `Validation Failed: ${messages.join(', ')}`);
        } else {
             req.flash('error_msg', `Failed to update draft: ${err.message}`);
        }
        // Redirect back to the edit page
        res.status(400).redirect(`/mint/drafts/${req.params.id}`);
    }
};


exports.prepareMint = async (req, res) => {
    const draftId = req.params.id;
    const userId = req.user._id;
    let creation; // Define creation in outer scope for potential error handling cleanup

    try {
        creation = await Creation.findOne({ _id: draftId, userId: userId });
        if (!creation) {
            return res.status(404).json({ success: false, message: 'Draft not found or access denied.' });
        }
        // Allow preparing only from 'draft' or 'error' state
        if (!['draft', 'error'].includes(creation.status)) {
            return res.status(400).json({ success: false, message: `Draft is not in a state to be prepared (current state: ${creation.status}).` });
        }
        if (!creation.originalFileName) {
            return res.status(400).json({ success: false, message: 'No file associated with this draft. Please upload a file.' });
        }

        // --- Update status ---
        creation.status = 'pending_ipfs';
        creation.errorMessage = null; // Clear previous errors
        await creation.save();

        // --- 1. Get File from Temp Storage ---
        const tempFileName = `${creation._id}-${creation.originalFileName}`;
        const tempFilePath = path.join(TEMP_UPLOAD_DIR, tempFileName);
        let fileBuffer;
        try {
            fileBuffer = await fs.readFile(tempFilePath);
        } catch (readErr) {
            console.error(`Error reading temp file ${tempFilePath}:`, readErr);
            throw new Error(`Failed to read associated file. Please re-upload if necessary. (${readErr.code})`);
        }

        // --- 2. Upload File to IPFS ---
        console.log(`Uploading file ${creation.originalFileName} to IPFS...`);
        const fileCid = await ipfsService.uploadToIPFS(fileBuffer);
        if (!fileCid) throw new Error('File upload to IPFS failed.');
        creation.fileCid = fileCid;
        console.log(`File uploaded: ${fileCid}`);

        // --- 3. Construct Metadata ---
        const metadata = {
            name: creation.title,
            description: creation.description,
            // Use 'image' or 'animation_url' based on file type - needs more robust logic
            [creation.fileType?.startsWith('image/') ? 'image' : 'animation_url']: `ipfs://${fileCid}`,
            // Standard attributes format for tags
            attributes: creation.tags.map(tag => ({ trait_type: "Tag", value: tag })),
            // Optional: Add custom properties if needed by your application or metaverse
            properties: {
                fileType: creation.fileType,
                // Example: Include creator addresses if desired (consider privacy)
                // creators: creation.creatorSplits.map(s => s.walletAddress)
            }
        };

        // --- 4. Upload Metadata to IPFS ---
         console.log("Uploading metadata to IPFS...");
        const metadataBuffer = Buffer.from(JSON.stringify(metadata, null, 2)); // Pretty print optional
        const metadataCid = await ipfsService.uploadToIPFS(metadataBuffer);
        if (!metadataCid) throw new Error('Metadata upload to IPFS failed.');
        creation.metadataCid = metadataCid;
        creation.metadataUri = `ipfs://${metadataCid}`;
        console.log(`Metadata uploaded: ${creation.metadataUri}`);

        // --- 5. Prepare Zora Data (Conceptual - Requires specific Zora logic) ---
        //    A) Determine Target Contract (which ERC1155 collection?)
        const chainId = process.env.CHAIN_ID || 1; // Get target chain ID from env
        const targetContractAddress = zoraService.getERC1155CreatorAddress(chainId); // Your logic here

        //    B) Handle Splits (May involve deploying/finding a Split contract)
        //    This is complex and depends on your chosen split strategy with Zora.
        //    let zoraSplitAddress = null;
        //    if (creation.creatorSplits && creation.creatorSplits.length > 0) {
        //        zoraSplitAddress = await zoraService.findOrCreateSplit(creation.creatorSplits);
        //        creation.zoraSplitContractAddress = zoraSplitAddress; // Save if needed
        //    }

        //    C) Prepare Mint Parameters (adapt based on actual Zora function)
        const mintParams = {
            recipient: req.user.walletAddress, // Mint to the user initiating
            quantity: 1, // Default to 1, make configurable?
            metadataURI: creation.metadataUri,
            mintReferral: creation.sellerCommission.referrerAddress || ethers.constants.AddressZero,
            // comment: `Minted via Mint House Aqua: ${creation.title}` // Optional comment
            // Potentially pass splitAddress if required by the mint function
        };

        //    D) Estimate Mint Fee (Crucial!)
        console.log("Estimating Zora mint fee...");
        // Pass necessary params for fee calculation (might include quantity, splits info etc.)
        const mintFeeWei = await zoraService.estimateMintFee(targetContractAddress, mintParams);
        console.log(`Estimated mint fee: ${ethers.utils.formatEther(mintFeeWei)} ETH`);

        // --- Update status and save IPFS/Zora data ---
        creation.status = 'pending_mint';
        creation.mintedContractAddress = targetContractAddress; // Store target address
        await creation.save();

        // --- 6. Delete Temporary File (after successful IPFS upload) ---
        await fs.unlink(tempFilePath).catch(err => console.error("Error deleting temp file:", err));

        // --- 7. Send Data to Frontend for Confirmation Step ---
        res.json({
            success: true,
            message: 'Ready to mint. Please review and confirm.',
            creationId: creation._id,
            metadataUri: creation.metadataUri,
            fileUri: `ipfs://${creation.fileCid}`, // For preview on confirm page
            fileType: creation.fileType,
            estimatedMintFee: ethers.utils.formatEther(mintFeeWei), // Formatted for display
            mintFeeWei: mintFeeWei.toString(), // Raw value for transaction
            targetContractAddress: targetContractAddress,
            // Send necessary ABI fragment or identifier for the mint function
            // E.g., using a known function name identifier
            mintFunctionName: 'mintWithRewards', // ** EXAMPLE - Use actual function name **
            mintParams: mintParams // Params needed by frontend JS to call the contract
        });

    } catch (err) {
        console.error(`Error preparing mint for draft ${draftId}:`, err);
        // Attempt to revert status back to 'error' on failure
        if (creation) {
            try {
                creation.status = 'error';
                creation.errorMessage = err.message || 'An unknown error occurred during preparation.';
                await creation.save();
            } catch (saveErr) { console.error("Failed to update status to error:", saveErr); }
        }
        res.status(500).json({ success: false, message: `Failed to prepare mint: ${err.message}` });
    }
};


exports.getGasEstimate = async (req, res) => {
    try {
        const feeData = await zoraService.getGasEstimateData(); // Use centralized function
        res.json({ success: true, ...feeData });
    } catch (err) {
        console.error("Error fetching gas estimate:", err);
        res.status(500).json({ success: false, message: 'Failed to get gas estimate.' });
    }
};

exports.recordMintSuccess = async (req, res) => {
    const draftId = req.params.id;
    const userId = req.user._id;
    // Validate input from frontend
    const { transactionHash, tokenId, contractAddress } = req.body;
    if (!transactionHash || !contractAddress) { // Token ID might be null/hard to get sometimes
        return res.status(400).json({ success: false, message: 'Missing transaction hash or contract address.' });
    }

    try {
        // Find the specific creation record waiting for mint confirmation
        const creation = await Creation.findOne({ _id: draftId, userId: userId });
        if (!creation) {
             return res.status(404).json({ success: false, message: 'Draft not found.' });
        }
        // Ensure it was in the correct state
        if (creation.status !== 'pending_mint') {
             console.warn(`Received mint success for draft ${draftId} but status was ${creation.status}`);
             // Decide how to handle this - maybe update anyway, maybe reject?
             // For now, let's allow updating from potentially stale state but log it.
        }

        // Update the record
        creation.status = 'minted';
        creation.transactionHash = transactionHash;
        creation.tokenId = tokenId || creation.tokenId; // Keep old one if new one not provided
        creation.mintedContractAddress = contractAddress || creation.mintedContractAddress;
        creation.errorMessage = null; // Clear any previous errors
        await creation.save();

        console.log(`Mint recorded successfully for draft ${draftId}, Tx: ${transactionHash}`);
        res.json({ success: true, message: 'Mint recorded successfully.' });

    } catch (err) {
        console.error(`Error recording mint success for draft ${draftId}:`, err);
        // This is tricky - the mint succeeded on-chain, but DB update failed.
        // Requires monitoring or retry mechanism ideally.
        res.status(500).json({ success: false, message: 'Failed to update database after mint confirmation.' });
    }
};
