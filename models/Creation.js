/**
 * models/Creation.js
 * Mongoose Schema for storing NFT creation drafts and minted data.
 */
const mongoose = require('mongoose');
const { ethers } = require('ethers'); // Required for ZeroAddress default
const Schema = mongoose.Schema;

// Sub-schema for defining creator splits
const CreatorSplitSchema = new Schema({
    // Consider linking to a User model if you have one:
    // userId: { type: Schema.Types.ObjectId, ref: 'User' },
    walletAddress: {
        type: String,
        required: [true, 'Wallet address is required for splits.'],
        // Basic validation - enhance as needed
        validate: {
            validator: function(v) {
                return ethers.utils.isAddress(v);
            },
            message: props => `${props.value} is not a valid Ethereum address!`
        }
    },
    sharePercentage: {
        type: Number,
        required: [true, 'Share percentage is required.'],
        min: [0, 'Share percentage cannot be negative.'],
        max: [100, 'Share percentage cannot exceed 100.']
    },
}, { _id: false }); // Don't create separate IDs for sub-documents

// Sub-schema for seller commission details
const CommissionSchema = new Schema({
    referrerAddress: {
        type: String,
        default: ethers.constants.AddressZero, // Use ZeroAddress for no referrer
        validate: {
            validator: function(v) {
                return ethers.utils.isAddress(v);
            },
            message: props => `${props.value} is not a valid Ethereum address!`
        }
    },
    // Note: Zora's actual commission might be set differently (e.g., fixed fee or percentage via ProtocolRewards)
    // This field is for storing the intended configuration.
    commissionPercentage: {
        type: Number,
        default: 0,
        min: [0, 'Commission percentage cannot be negative.'],
        max: [100, 'Commission percentage cannot exceed 100.']
    }
}, { _id: false });

// Main schema for NFT Creations
const CreationSchema = new Schema({
    userId: { // The user who initiated the creation draft
        type: Schema.Types.ObjectId,
        ref: 'User', // Assuming a User model exists and is required
        required: true,
        index: true // Index for faster lookups by user
    },
    title: {
        type: String,
        required: [true, 'Title is required.'],
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    tags: [{ // Array of tags/keywords for categorization/search
        type: String,
        trim: true,
        lowercase: true
    }],

    // --- File Info (Details stored before/after IPFS upload) ---
    originalFileName: { type: String }, // Original name of the uploaded file
    fileType: { type: String }, // e.g., 'image/jpeg', 'video/mp4', 'model/gltf-binary'
    fileSizeBytes: { type: Number }, // Size of the file in bytes
    // Consider adding a field for temporary storage path if using disk storage with multer
    // tempFilePath: { type: String },

    // --- IPFS Data (Populated after successful upload) ---
    fileCid: { type: String, trim: true, index: true }, // IPFS CID for the media file (v0 or v1)
    metadataCid: { type: String, trim: true }, // IPFS CID for the metadata JSON
    metadataUri: { type: String, trim: true }, // Full IPFS URI (e.g., ipfs://<metadata_cid>)

    // --- Collaboration & Revenue ---
    creatorSplits: {
        type: [CreatorSplitSchema],
        // Custom validation to ensure percentages add up to 100
        validate: [
            {
                validator: function (splits) {
                    if (!splits || splits.length === 0) return true; // Allow no splits (implies 100% to creator)
                    const total = splits.reduce((sum, split) => sum + (split.sharePercentage || 0), 0);
                    // Use a small tolerance for potential floating point inaccuracies
                    return Math.abs(total - 100) < 0.001;
                },
                message: 'Creator split percentages must add up to exactly 100%.'
            },
            { // Ensure unique wallet addresses within splits
                 validator: function (splits) {
                    if (!splits || splits.length <= 1) return true;
                    const addresses = splits.map(s => s.walletAddress.toLowerCase());
                    return new Set(addresses).size === addresses.length;
                 },
                 message: 'Duplicate wallet addresses found in creator splits.'
            }
        ]
    },
    // Optional: Store the address of the deployed Zora Split contract if one is created/used
    // zoraSplitContractAddress: { type: String, validate: { validator: ethers.utils.isAddress, msg: 'Invalid Splitter Address'} },

    // --- Sales Commission ---
    sellerCommission: {
        type: CommissionSchema,
        default: () => ({}) // Ensure default object is created
    },

    // --- Status Tracking ---
    status: {
        type: String,
        enum: ['draft', 'pending_ipfs', 'pending_mint', 'minted', 'error'], // Workflow states
        default: 'draft',
        index: true
    },
    errorMessage: { type: String }, // Store details if an error occurs during the process
    transactionHash: { type: String, index: true }, // Blockchain transaction hash of the mint
    tokenId: { type: String, index: true }, // The minted token ID (especially relevant for ERC1155)
    mintedContractAddress: { type: String }, // Address of the Zora collection contract used

}, {
    timestamps: true // Automatically add createdAt and updatedAt fields
});

// --- Optional: Pre-save hook for additional validation or data processing ---
// CreationSchema.pre('save', function(next) {
//     // Example: ensure tags are unique? clean data?
//     next();
// });

module.exports = mongoose.model('Creation', CreationSchema);
