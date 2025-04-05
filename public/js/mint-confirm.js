/**
 * public/js/mint-confirm.js
 * Handles logic for the final mint confirmation page, including gas price polling
 * and initiating the mint transaction via the user's wallet.
 */

// --- Wait for DOM to load ---
document.addEventListener('DOMContentLoaded', () => {

    // --- Get Elements ---
    const mintButton = document.getElementById('mint-now-button');
    const gasInfoElement = document.getElementById('gas-info');
    const estimatedCostElement = document.getElementById('estimated-cost');
    const mintDataElement = document.getElementById('mint-data'); // Hidden element holding data from backend
    const statusMessageElement = document.getElementById('status-message');

    // --- State Variables ---
    let mintData = null; // Parsed data from backend (fee, params, etc.)
    let currentGasData = null; // Store latest fetched gas data (gwei)
    let isMinting = false; // Prevent double-clicks
    let gasPollInterval = null;

    // --- Parse Mint Data ---
    if (mintDataElement) {
        try {
            mintData = JSON.parse(mintDataElement.textContent);
            console.log("Mint data loaded:", mintData);
            // Validate essential data exists
            if (!mintData || !mintData.mintFeeWei || !mintData.targetContractAddress || !mintData.mintFunctionName || !mintData.mintParams || !mintData.creationId) {
                throw new Error("Incomplete mint data received from server.");
            }
        } catch (e) {
            console.error("Failed to parse mint data:", e);
            setStatusMessage("Error: Failed to load minting details. Please go back and try again.", true);
            if (mintButton) mintButton.disabled = true;
        }
    } else {
        setStatusMessage("Error: Minting data element not found.", true);
        if (mintButton) mintButton.disabled = true;
    }

    // === Gas Price Functions ===

    async function fetchGasPrice() {
        if (isMinting) return; // Don't fetch while minting

        try {
            const response = await fetch('/mint/gas-estimate'); // Your backend endpoint
            if (!response.ok) {
                console.error(`Gas fetch failed with status: ${response.status}`);
                // Don't show error constantly, maybe just log or show once
                // setStatusMessage("Could not fetch current gas price.", false);
                return;
            }
            const data = await response.json();

            if (data.success) {
                currentGasData = data; // Store the whole object { gasPrice, maxFeePerGas, maxPriorityFeePerGas }
                updateGasDisplay();
            } else {
                console.warn("Gas estimate endpoint returned success:false");
            }
        } catch (error) {
            console.error('Error fetching gas price:', error);
            // setStatusMessage("Network error fetching gas price.", false);
        }
    }

    function updateGasDisplay() {
        if (!currentGasData) return;

        // Prefer EIP-1559 fees if available
        let displayPrice = currentGasData.maxFeePerGas ? parseFloat(currentGasData.maxFeePerGas) : (currentGasData.gasPrice ? parseFloat(currentGasData.gasPrice) : null);

        if (displayPrice !== null) {
            gasInfoElement.textContent = `Current Gas: ~${displayPrice.toFixed(2)} Gwei`;
            updateEstimatedCost(displayPrice);
        } else {
            gasInfoElement.textContent = 'Gas price unavailable.';
            estimatedCostElement.textContent = 'Est. Total Cost: N/A';
        }
    }

    function updateEstimatedCost(gasPriceGwei) {
        if (!mintData || !mintData.mintFeeWei) return;

        // VERY ROUGH ESTIMATE - Gas limit varies greatly!
        // TODO: Get a better gas limit estimate, maybe pass from backend simulation?
        const estimatedGasLimit = BigInt(350000); // ** EXAMPLE - Needs refinement **

        try {
            // Calculate gas cost in Wei (Gwei * 1e9)
            const gasPriceWei = BigInt(Math.ceil(gasPriceGwei * 1e9));
            const gasCostWei = gasPriceWei * estimatedGasLimit;

            // Total cost = Zora Fee (from backend) + Estimated Gas Cost
            const totalCostWei = BigInt(mintData.mintFeeWei) + gasCostWei;

            estimatedCostElement.textContent = `Est. Total Cost: ~${ethers.utils.formatEther(totalCostWei)} ETH`;
        } catch (e) {
             console.error("Error calculating estimated cost:", e);
             estimatedCostElement.textContent = 'Est. Total Cost: Error';
        }
    }

    // === Minting Function ===

    async function handleMint() {
        if (isMinting || !mintData) return; // Prevent double minting or minting without data

        // 1. Check Wallet Connection
        if (typeof window.ethereum === 'undefined') {
            setStatusMessage("Wallet not detected. Please install MetaMask or another compatible wallet.", true);
            return;
        }

        isMinting = true;
        mintButton.disabled = true;
        mintButton.textContent = 'Processing...';
        setStatusMessage("Please check your wallet to confirm the transaction...", false);
        stopGasPolling(); // Stop polling while transaction is active

        try {
            // 2. Connect to Wallet & Get Signer
            // Use ethers v6 syntax
            const provider = new ethers.BrowserProvider(window.ethereum);
            // Request account access
            await provider.send("eth_requestAccounts", []);
            const signer = await provider.getSigner();
            const userAddress = await signer.getAddress();
            console.log("Wallet connected:", userAddress);

            // 3. Prepare Contract Instance & Transaction
            // We need the ABI fragment for the specific mint function
            // Assuming backend provided the function ABI object in mintData.mintFunctionAbiFragment
            // For simplicity, let's assume the function name is in mintData.mintFunctionName
            // and the ABI is available (e.g., loaded globally or passed completely - less ideal)
            // ** A better approach passes the minimal ABI fragment needed **
            const functionAbiFragment = zoraService.getMintFunctionAbiFragment(mintData.mintFunctionName); // Needs Zora service on frontend or pass fragment
            if (!functionAbiFragment) {
                 throw new Error(`ABI for function ${mintData.mintFunctionName} not available.`);
            }

            const zoraContract = new ethers.Contract(
                mintData.targetContractAddress,
                [functionAbiFragment], // Use the single function ABI fragment
                signer
            );

            // 4. Prepare Arguments Dynamically (Order matters!)
            // This needs to precisely match the function signature defined in the ABI fragment
            const args = [];
            // Example mapping based on hypothetical 'mintWithRewards' signature:
            // mintWithRewards(address recipient, uint256 quantity, string memory tokenURI, string memory comment, address mintReferral)
            // Adjust based on the ACTUAL function signature used!
            if (mintData.mintFunctionName === 'mintWithRewards') { // ** EXAMPLE MAPPING **
                 args.push(mintData.mintParams.recipient);
                 args.push(mintData.mintParams.quantity);
                 args.push(mintData.mintParams.metadataURI); // Assuming this is the tokenURI param
                 args.push(`Minted via Mint House Aqua: ${mintData.title || mintData.creationId}`); // Example comment
                 args.push(mintData.mintParams.mintReferral);
            } else {
                 // Handle other mint functions if necessary
                 throw new Error(`Mint function parameters not configured for: ${mintData.mintFunctionName}`);
            }


            // 5. Prepare Transaction Options (Value for fees)
            const txOptions = {
                value: mintData.mintFeeWei // The required fee passed as msg.value
                // Let wallet handle gas estimation by default for simplicity.
                // Advanced: Could add gas limits based on currentGasData if implementing target gas logic.
            };

            console.log(`Calling ${mintData.mintFunctionName} on ${mintData.targetContractAddress}`);
            console.log('Arguments:', args);
            console.log('Tx Options:', txOptions);

            // 6. Send Transaction
            setStatusMessage("Sending transaction to wallet for confirmation...", false);
            const tx = await zoraContract[mintData.mintFunctionName](...args, txOptions);
            setStatusMessage(`Transaction submitted! Hash: ${tx.hash}. Waiting for confirmation...`, false);
            console.log(`Transaction sent: ${tx.hash}`);

            // 7. Wait for Confirmation
            const receipt = await tx.wait(1); // Wait for 1 block confirmation
            console.log('Transaction confirmed:', receipt);

            // 8. Extract Token ID (Best effort - depends heavily on Zora contract events)
            let mintedTokenId = null;
            try {
                // Look for standard ERC1155 TransferSingle event
                const transferSingleEventTopic = ethers.id("TransferSingle(address,address,address,uint256,uint256)");
                const transferEvent = receipt.logs?.find(log => log.address.toLowerCase() === mintData.targetContractAddress.toLowerCase() && log.topics[0] === transferSingleEventTopic);

                if (transferEvent) {
                    // Need full contract ABI to parse accurately, but can try basic decoding if ABI known
                    // This part is fragile without the full ABI available client-side
                    // const decodedLog = zoraContract.interface.parseLog(transferEvent); // Requires full interface
                    // mintedTokenId = decodedLog.args.id.toString();

                    // Manual decoding attempt (less reliable): topics[3] is often from address, topics[4] is often to address
                    // The data part holds tokenId and value. tokenId is often the first 32 bytes (uint256) in data.
                     if (transferEvent.data && transferEvent.data.length >= 66) { // 0x + 64 hex chars
                         mintedTokenId = ethers.BigNumber.from(transferEvent.data.substring(0, 66)).toString();
                         console.log("Attempted to decode Token ID:", mintedTokenId);
                     }
                } else {
                     console.log("Standard ERC1155 TransferSingle event not found in receipt logs.");
                     // Look for other potential Zora-specific mint events if necessary
                }
            } catch(parseError) {
                 console.error("Could not parse Token ID from receipt logs:", parseError);
            }


            // 9. Notify Backend
            setStatusMessage("Mint successful! Updating database...", false);
            const recordResponse = await fetch(`/mint/record-mint/${mintData.creationId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transactionHash: receipt.transactionHash,
                    tokenId: mintedTokenId, // Send parsed ID or null
                    contractAddress: mintData.targetContractAddress
                })
            });

            if (!recordResponse.ok) {
                const recordError = await recordResponse.text();
                throw new Error(`Mint succeeded but failed to record in DB: ${recordError}`);
            }

            // 10. Final Success Feedback
            setStatusMessage(`NFT Minted Successfully! Tx: ${receipt.transactionHash}${mintedTokenId ? ` | Token ID: ${mintedTokenId}` : ''}`, false);
            alert(`NFT Minted Successfully!${mintedTokenId ? ` Token ID: ${mintedTokenId}` : ''}`);

            // Optional: Redirect after a short delay
            setTimeout(() => {
                window.location.href = '/dashboard'; // Redirect to user's collection/dashboard
            }, 3000);


        } catch (error) {
            console.error("Minting Process Error:", error);
            // Handle common errors like user rejection
            if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
                setStatusMessage("Transaction rejected in wallet.", true);
            } else {
                setStatusMessage(`Minting failed: ${error.message}`, true);
            }
            isMinting = false;
            mintButton.disabled = false;
            mintButton.textContent = 'Mint Now';
            startGasPolling(); // Resume polling on failure
        }
    }

    // --- Utility Functions ---
    function setStatusMessage(message, isError = false) {
        if (statusMessageElement) {
            statusMessageElement.textContent = message;
            statusMessageElement.className = isError ? 'status-error' : 'status-info'; // Add CSS classes for styling
            statusMessageElement.style.display = 'block';
        } else {
            // Fallback if status element doesn't exist
            if (isError) alert(`Error: ${message}`);
            else console.log(`Status: ${message}`);
        }
    }

    function startGasPolling() {
        if (gasPollInterval) clearInterval(gasPollInterval); // Clear existing interval
        fetchGasPrice(); // Initial fetch
        gasPollInterval = setInterval(fetchGasPrice, 20000); // Poll every 20 seconds
    }

    function stopGasPolling() {
         if (gasPollInterval) clearInterval(gasPollInterval);
         gasPollInterval = null;
    }


    // --- Initialization ---
    if (mintButton && mintData) { // Only enable if data loaded correctly
        mintButton.addEventListener('click', handleMint);
        startGasPolling();
    } else if (mintButton) {
         mintButton.disabled = true; // Keep disabled if data failed to load
         mintButton.textContent = 'Data Error';
    }

}); // End DOMContentLoaded
