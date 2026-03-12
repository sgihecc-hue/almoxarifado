export function formatRequestNumber(id: string): string {
  // Validate input
  if (!id || typeof id !== 'string') {
    return '0000';
  }
  
  // Ensure the ID is long enough
  if (id.length < 4) {
    return id.padStart(4, '0');
  }
  
  // Get last 4 characters of UUID and convert to decimal
  const lastFourChars = id.slice(-4);
  const shortId = parseInt(lastFourChars, 16);
  
  // Handle invalid hex conversion
  if (isNaN(shortId)) {
    // Fallback: use the last 4 characters as-is if hex conversion fails
    return lastFourChars.padStart(4, '0');
  }
  
  // Ensure it's padded to at least 4 digits
  return String(shortId).padStart(4, '0');
}