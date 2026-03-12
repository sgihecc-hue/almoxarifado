/**
 * Sanitizes user input to prevent XSS attacks
 */
export function sanitizeInput(input: string): string {
  if (input === null || input === undefined) {
    return ''
  }
  
  if (typeof input !== 'string') {
    input = String(input)
  }
  
  // Prevent extremely long inputs (DoS protection)
  if (input.length > 10000) {
    input = input.substring(0, 10000)
  }
  
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
    .substring(0, 1000)
}

/**
 * More aggressive sanitization for HTML content
 */
export function sanitizeHtml(input: string): string {
  if (!input || typeof input !== 'string') {
    return ''
  }
  
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
    .substring(0, 1000)
}
/**
 * Validates email format
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  return emailRegex.test(email)
}

/**
 * Sanitizes email for authentication (no HTML encoding)
 */
export function sanitizeEmailForAuth(email: string): string {
  if (!email || typeof email !== 'string') {
    return ''
  }
  
  // Only trim whitespace and convert to lowercase
  // Do NOT apply HTML entity encoding to emails
  return email.trim().toLowerCase()
}

/**
 * Sanitizes text input for safe display (with HTML encoding)
 */
export function sanitizeForDisplay(input: string): string {
  if (!input || typeof input !== 'string') {
    return ''
  }
  
  // Apply HTML entity encoding for safe display
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
    .substring(0, 1000)
}

/**
 * Validates phone number format
 */
export function validatePhone(phone: string): boolean {
  if (!phone || typeof phone !== 'string') return false
  const phoneRegex = /^\(\d{2}\)\s\d{4,5}-\d{4}$/
  return phoneRegex.test(phone)
}

/**
 * Validates CNPJ format
 */
export function validateCNPJ(cnpj: string): boolean {
  if (!cnpj || typeof cnpj !== 'string') return false
  const cnpjRegex = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/
  return cnpjRegex.test(cnpj)
}

/**
 * Prevents code injection in search queries
 */
export function sanitizeSearchQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    return ''
  }
  
  return query
    .replace(/[<>'"&%();]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/script/gi, '')
    .replace(/javascript/gi, '')
    .replace(/vbscript/gi, '')
    .replace(/data:/gi, '')
    .trim()
    .substring(0, 100) // Limit length
}

/**
 * Validates numeric input
 */
export function validateNumeric(value: string | number): boolean {
  const num = typeof value === 'string' ? parseFloat(value) : value
  return !isNaN(num) && isFinite(num) && num >= 0
}

/**
 * Validates UUID format
 */
export function validateUUID(uuid: string): boolean {
  if (!uuid || typeof uuid !== 'string') return false
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

/**
 * Validates and sanitizes file name
 */
export function sanitizeFileName(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') return ''
  
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .trim()
    .substring(0, 255)
}

/**
 * Rate limiting helper
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map()
  
  isAllowed(key: string, maxRequests: number, windowMs: number): boolean {
    if (!key || typeof key !== 'string') {
      return false
    }
    
    const now = Date.now()
    const window = this.requests.get(key) || []
    
    // Remove old requests outside the window
    const validRequests = window.filter(time => now - time < windowMs)
    
    if (validRequests.length >= maxRequests) {
      return false
    }
    
    validRequests.push(now)
    this.requests.set(key, validRequests)
    return true
  }

  clear(key: string): void {
    if (!key || typeof key !== 'string') {
      return
    }
    this.requests.delete(key)
  }

  // Clean up old entries periodically
  cleanup(windowMs: number): void {
    const now = Date.now()
    for (const [key, requests] of this.requests.entries()) {
      const validRequests = requests.filter(time => now - time < windowMs)
      if (validRequests.length === 0) {
        this.requests.delete(key)
      } else {
        this.requests.set(key, validRequests)
      }
    }
  }
  
}

/**
 * Escapes HTML entities in text
 */
export function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#x27;'
  }
  return text.replace(/[<>&"']/g, (m) => map[m])
}