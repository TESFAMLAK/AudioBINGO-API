
// Helper function to clean and validate CBE transaction ID
export function cleanAndValidateTransaction(input, paymentMethod) {
    // Remove any whitespace and convert to uppercase
    input = input.trim().toUpperCase();
    
    // Different validation for different payment methods
    switch(paymentMethod.toLowerCase()) {
        case 'cbe':
            // Check if it's a URL format and extract the ID
            if (input.includes('APPS.CBE.COM.ET') || input.includes('?ID=')) {
                const match = input.match(/[?&]ID=([A-Z0-9]+)/i);
                if (match) {
                    input = match[1];
                }
            }
            
            // Extract just the FT part (12 or 20 characters)
            const ftMatch = input.match(/FT\w{10}(?:\w{8})?/);
            if (!ftMatch) {
                throw new Error('Invalid CBE transaction format');
            }
            
            // Take only first 12 characters if it's longer
            return ftMatch[0].substring(0, 12);
            
        case 'telebirr':
            // Telebirr format validation (10-digit number )
            const telebirrMatch = input.match(/^[A-Z0-9]{10}$/);
            if (!telebirrMatch) {
                throw new Error('Invalid Telebirr transaction format');
            }
            return input;
            
        case 'cbebirr':
            // CBE Birr format validation (10-character alphanumeric)
            const cbebirrMatch = input.match(/^[A-Z0-9]{10}$/);
            if (!cbebirrMatch) {
                throw new Error('Invalid CBE Birr transaction format');
            }
            return input;
            
        default:
            throw new Error('Unsupported payment method');
    }
}
