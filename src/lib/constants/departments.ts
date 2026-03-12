// This file provides department-related constants and utility functions
import { departmentsService } from '../services/departments';
import { sanitizeInput } from '../utils/sanitize';

// Cache for department names to avoid repeated API calls
let departmentCache: Record<string, string> = {};
let departmentsLoaded = false;
let loadingPromise: Promise<void> | null = null;
let lastLoadTime = 0;
const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes (reduced for fresher data)

// Function to load all departments into cache
async function loadDepartments() {
  // Check if cache is still valid
  if (departmentsLoaded && Date.now() - lastLoadTime < CACHE_DURATION) {
    return;
  }
  
  // Prevent multiple simultaneous loads (race condition fix)
  if (loadingPromise) {
    return loadingPromise;
  }
  
  loadingPromise = new Promise(async (resolve, reject) => {
    try {
      const departments = await departmentsService.getAll();
      
      // Validate departments data
      if (!Array.isArray(departments)) {
        console.error('Invalid departments data received');
        reject(new Error('Invalid departments data'));
        return;
      }
      
      // Clear existing cache
      departmentCache = {};
      
      departments.forEach((dept) => {
        // Validate department data before caching
        if (dept && typeof dept === 'object' && dept.id && dept.name) {
          const sanitizedId = sanitizeInput(dept.id);
          const sanitizedName = sanitizeInput(dept.name);
          if (sanitizedId && sanitizedName) {
            departmentCache[sanitizedId] = sanitizedName;
          }
        }
      });
      departmentsLoaded = true;
      lastLoadTime = Date.now();
      resolve();
    } catch (error) {
      console.error('Error loading departments:', error);
      // Don't set departmentsLoaded to true on error
      reject(error);
    } finally {
      loadingPromise = null;
    }
  });
  
  return loadingPromise;
}

// Force reload departments (for when data changes)
export function reloadDepartments() {
  departmentsLoaded = false;
  lastLoadTime = 0;
  departmentCache = {};
  return loadDepartments();
}

// Initialize by loading departments
// Safe initialization check
if (typeof window !== 'undefined' && typeof document !== 'undefined' && !departmentsLoaded) {
  loadDepartments();
}

/**
 * Get department name from ID
 * @param id Department ID
 * @returns Department name or the ID if not found
 */
export function getDepartmentName(id: string): string {
  // Validate input
  if (!id || typeof id !== 'string') {
    return 'ID inválido';
  }

  // Basic input sanitization
  const sanitizedId = sanitizeInput(id.trim());

  if (!sanitizedId) {
    return 'ID inválido';
  }

  // If we have the department name in cache, return it
  if (departmentCache[sanitizedId]) {
    return departmentCache[sanitizedId];
  }

  // If not in cache, try to load departments again (but don't wait for it)
  if (!departmentsLoaded) {
    loadDepartments();
  }

  // Return the ID itself if we can't find the name
  // This ensures something is displayed even if the department isn't found
  return sanitizedId;
}

/**
 * Get all cached department codes
 */
export function getCachedDepartmentCodes(): string[] {
  return Object.keys(departmentCache);
}

/**
 * Check if departments are loaded
 */
export function areDepartmentsLoaded(): boolean {
  return departmentsLoaded;
}

// Export empty departments array for backward compatibility
const departments = [] as const;
export default departments;