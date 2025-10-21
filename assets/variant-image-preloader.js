import { Component } from '@theme/component';

/**
 * A custom element that preloads all variant images and manages color switching
 * without making additional requests.
 */
export default class VariantImagePreloader extends Component {
  #preloadedImages = new Map();
  /** @type {{variants?: Array<any>, media?: Array<any>} | null} */
  #productData = null;
  /** @type {number | null} */
  #hoverDebounceTimer = null;
  /** @type {Set<string>} */
  #preloadQueue = new Set();

  connectedCallback() {
    super.connectedCallback();
    
    // Get product data from the page
    this.#loadProductData();
    
    // Setup hover-based preloading
    this.#setupHoverPreload();
    
    // Preload current variant images immediately
    this.#preloadCurrentVariant();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    
    // Clean up debounce timer
    this.#clearDebounce();
    
    // Clear preload queue
    this.#preloadQueue.clear();
  }

  /**
   * Preloads images for the currently selected variant
   */
  #preloadCurrentVariant() {
    const selectedInput = document.querySelector('variant-picker input[type="radio"]:checked');
    if (selectedInput instanceof HTMLInputElement && this.#isColorOption(selectedInput)) {
      const colorValue = selectedInput.value;
      // Preload immediately without debounce
      this.#preloadImagesForColor(colorValue);
    }
  }

  /**
   * Sets up hover-based preloading for color options
   */
  #setupHoverPreload() {
    const variantPicker = document.querySelector('variant-picker');
    if (!variantPicker) return;

    // Use event delegation for better performance
    variantPicker.addEventListener('mouseenter', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      
      // Check if it's a color option
      const input = this.#findColorInput(target);
      if (input) {
        const colorValue = input.value;
        // Don't preload if already selected
        if (!input.checked) {
          this.#debouncedPreload(colorValue);
        }
      }
    }, true);

    // Clear debounce on mouse leave
    variantPicker.addEventListener('mouseleave', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      
      if (target.matches('input[type="radio"][data-option-value-id], .variant-option__button-label')) {
        this.#clearDebounce();
      }
    }, true);
  }

  /**
   * Finds the color input element from a target
   * @param {HTMLElement} target
   * @returns {HTMLInputElement | null}
   */
  #findColorInput(target) {
    if (target.matches('input[type="radio"][data-option-value-id]') && target instanceof HTMLInputElement) {
      if (this.#isColorOption(target)) {
        return target;
      }
    }
    
    if (target.matches('.variant-option__button-label')) {
      const input = target.querySelector('input[type="radio"]');
      if (input instanceof HTMLInputElement && this.#isColorOption(input)) {
        return input;
      }
    }
    
    return null;
  }

  /**
   * Debounced preload to avoid excessive requests when hovering quickly
   * @param {string} colorValue - The color value to preload
   */
  #debouncedPreload(colorValue) {
    // Clear any existing timer
    this.#clearDebounce();
    
    // Set new timer with reduced delay for better UX
    this.#hoverDebounceTimer = window.setTimeout(() => {
      this.#preloadImagesForColor(colorValue);
      this.#hoverDebounceTimer = null;
    }, 150); // 150ms debounce delay
  }

  /**
   * Clears the debounce timer
   */
  #clearDebounce() {
    if (this.#hoverDebounceTimer !== null) {
      clearTimeout(this.#hoverDebounceTimer);
      this.#hoverDebounceTimer = null;
    }
  }

  /**
   * Checks if an input is a color option
   * @param {HTMLElement} element
   * @returns {boolean}
   */
  #isColorOption(element) {
    const fieldset = element.closest('fieldset.variant-option');
    if (!fieldset) return false;
    
    const legend = fieldset.querySelector('.variant-option__name');
    if (!legend) return false;
    
    const optionName = legend.textContent?.toLowerCase().trim() || '';
    return optionName.includes('color') || 
           optionName.includes('colour') || 
           optionName.includes('renk') ||
           optionName === 'color' ||
           optionName === 'colour' ||
           optionName === 'renk';
  }

  /**
   * Preloads images for a specific color
   * @param {string} colorValue - The color value
   */
  async #preloadImagesForColor(colorValue) {
    if (!this.#productData) return;

    const colorKey = colorValue.toUpperCase().replace(/\s+/g, '');
    
    // Check if already in queue or preloading
    if (this.#preloadQueue.has(colorKey)) {
      return;
    }
    
    this.#preloadQueue.add(colorKey);

    /** @type {Array<{src: string, alt: string, variantId?: number, mediaId?: number}>} */
    const imagesToPreload = [];

    // Find variants matching this color
    if (this.#productData.variants && Array.isArray(this.#productData.variants)) {
      this.#productData.variants.forEach(variant => {
        // Check if variant has this color
        const variantOptions = variant.options || [];
        const hasColor = variantOptions.some(/** @param {any} opt */ opt => 
          opt.toUpperCase().replace(/\s+/g, '') === colorKey
        );

        if (hasColor && variant.featured_image?.src) {
          // Prioritize responsive sizes
          const sizes = [800, 1200, 1600];
          sizes.forEach(size => {
            const url = this.#getImageUrl(variant.featured_image.src, size);
            if (!this.#preloadedImages.has(url)) {
              imagesToPreload.push({
                src: url,
                alt: variant.featured_image.alt || variant.name || '',
                variantId: variant.id
              });
            }
          });
        }
      });
    }

    // Also check media associated with color variants
    if (this.#productData.media && Array.isArray(this.#productData.media)) {
      this.#productData.media.forEach(media => {
        if (media.media_type === 'image' && media.src) {
          // Check if this media is associated with any color variant
          const isAssociatedWithColor = this.#productData?.variants?.some(variant => {
            const variantOptions = variant.options || [];
            const hasColor = variantOptions.some(/** @param {any} opt */ opt => 
              opt.toUpperCase().replace(/\s+/g, '') === colorKey
            );
            return hasColor && variant.featured_image?.id === media.id;
          });
          
          if (isAssociatedWithColor) {
            const sizes = [800, 1200, 1600];
            sizes.forEach(size => {
              const url = this.#getImageUrl(media.src, size);
              if (!this.#preloadedImages.has(url)) {
                imagesToPreload.push({
                  src: url,
                  alt: media.alt || '',
                  mediaId: media.id
                });
              }
            });
          }
        }
      });
    }

    if (imagesToPreload.length > 0) {
      console.log(`🖼️  Preloading ${imagesToPreload.length} images for: ${colorValue}`);
      
      try {
        await this.#preloadImageSet(imagesToPreload);
        console.log(`✅ Images preloaded successfully for: ${colorValue}`);
      } catch (error) {
        console.warn(`⚠️  Some images failed to preload for: ${colorValue}`, error);
      }
    }
    
    // Remove from queue after completion
    this.#preloadQueue.delete(colorKey);
  }

  /**
   * Loads product data from the page JSON
   */
  #loadProductData() {
    const productDataScript = document.querySelector('script[data-product-json]');
    if (productDataScript?.textContent) {
      try {
        this.#productData = JSON.parse(productDataScript.textContent);
        console.log('✓ Product data loaded:', {
          variants: this.#productData?.variants?.length || 0,
          media: this.#productData?.media?.length || 0
        });
      } catch (error) {
        console.error('❌ Error parsing product data:', error);
      }
    } else {
      console.warn('⚠️  Product data script not found');
    }
  }

  /**
   * Gets Shopify image URL with specific width
   * @param {string} src
   * @param {number} width
   */
  #getImageUrl(src, width) {
    if (!src) return '';
    
    // Remove existing size parameters
    let url = src.split('?')[0];
    
    // Add width parameter
    return `${url}?width=${width}`;
  }

  /**
   * Preloads a set of images with error handling
   * @param {Array<{src: string, alt: string, variantId?: number, mediaId?: number}>} images
   */
  async #preloadImageSet(images) {
    // Use allSettled to continue even if some images fail
    const results = await Promise.allSettled(
      images.map(image => this.#preloadImage(image))
    );
    
    // Log any failures for debugging
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(`${failures.length} images failed to preload`, failures);
    }
  }

  /**
   * Preloads a single image with timeout
   * @param {{src: string, alt: string, variantId?: number, mediaId?: number}} image
   * @returns {Promise<void>}
   */
  #preloadImage(image) {
    return new Promise((resolve, reject) => {
      if (this.#preloadedImages.has(image.src)) {
        resolve();
        return;
      }

      // Set timeout to avoid hanging
      const timeout = setTimeout(() => {
        reject(new Error(`Image preload timeout: ${image.src}`));
      }, 10000); // 10 second timeout

      const img = new Image();
      
      img.onload = () => {
        clearTimeout(timeout);
        this.#preloadedImages.set(image.src, {
          element: img,
          ...image
        });
        resolve();
      };
      
      img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`Failed to load: ${image.src}`));
      };
      
      img.src = image.src;
    });
  }

  /**
   * Gets a preloaded image by URL
   * @param {string} src
   */
  getPreloadedImage(src) {
    return this.#preloadedImages.get(src);
  }

  /**
   * Checks if an image is preloaded
   * @param {string} src
   */
  isImagePreloaded(src) {
    return this.#preloadedImages.has(src);
  }

  /**
   * Gets the total number of preloaded images
   */
  get preloadedCount() {
    return this.#preloadedImages.size;
  }

  /**
   * Gets preload statistics
   */
  getStats() {
    return {
      preloadedCount: this.#preloadedImages.size,
      queueSize: this.#preloadQueue.size,
      isPreloading: this.#preloadQueue.size > 0
    };
  }
}

if (!customElements.get('variant-image-preloader')) {
  customElements.define('variant-image-preloader', VariantImagePreloader);
}