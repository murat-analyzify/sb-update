import { Component } from '@theme/component';
import { VariantSelectedEvent, VariantUpdateEvent } from '@theme/events';
import { morph } from '@theme/morph';

/**
 * A custom element that manages a variant picker.
 *
 * @template {import('@theme/component').Refs} [Refs = {}]
 *
 * @extends Component<Refs>
 */
export default class VariantPicker extends Component {
  /** @type {string | undefined} */
  #pendingRequestUrl;

  /** @type {AbortController | undefined} */
  #abortController;

  /** @type {Map<string, string>} */
  #htmlCache = new Map();
  
  /** @type {number} */
  #MAX_CACHE_SIZE = 50;

  /** @type {boolean} */
  #listenersAttached = false;

  /** @type {((event: Event) => void) | null} */
  #boundHoverHandler = null;

  /** @type {((event: Event) => void) | null} */
  #boundLeaveHandler = null;

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener('change', this.variantChanged.bind(this));
    this.setupVariantHoverListeners();
    
    // Cache current page and prefetch available color variants for current size
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        this.#cacheCurrentPage();
        this.#prefetchAvailableColorVariants();
      }, { timeout: 100 });
    } else {
      // Safari fallback
      setTimeout(() => {
        this.#cacheCurrentPage();
        this.#prefetchAvailableColorVariants();
      }, 100);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    
    // Remove event listeners to prevent memory leaks
    if (this.#listenersAttached && this.#boundHoverHandler && this.#boundLeaveHandler) {
      this.removeEventListener('mouseenter', this.#boundHoverHandler, true);
      this.removeEventListener('mouseleave', this.#boundLeaveHandler, true);
      this.#listenersAttached = false;
      this.#boundHoverHandler = null;
      this.#boundLeaveHandler = null;
    }
    
    // Clear cache to prevent memory leaks
    this.#htmlCache.clear();
  }

  /**
   * Caches the current page HTML to avoid refetching when returning to initial variant
   */
  #cacheCurrentPage() {
    // Get all currently checked options (all variant dimensions: color, size, etc.)
    const allCheckedOptions = Array.from(this.querySelectorAll('input:checked[data-option-value-id]'));

    // Build URL using all selected options
    const optionValueIds = allCheckedOptions
      .filter(option => option instanceof HTMLElement)
      .map(option => option.dataset.optionValueId)
      .filter(id => id !== undefined);
    
    if (optionValueIds.length === 0) return;
    
    // Build URL manually to match what buildRequestUrl will produce
    const productUrl = this.dataset.productUrl;
    const url = `${productUrl}?option_values=${optionValueIds.join(',')}`;
    
    // Cache only the main element to reduce memory footprint
    const mainElement = document.querySelector('main');
    if (!mainElement) return;
    
    // Store only the main element without wrapper (DOMParser will auto-wrap)
    const currentHtml = mainElement.outerHTML;
    
    // Check cache size before adding
    if (this.#htmlCache.size >= this.#MAX_CACHE_SIZE) {
      const firstKey = this.#htmlCache.keys().next().value;
      this.#htmlCache.delete(firstKey);
    }
    
    this.#htmlCache.set(url, currentHtml);

  }

  /**
   * Prefetches color variants after a size change
   */
  #prefetchAfterSizeChange() {
    // Use requestIdleCallback to avoid blocking UI updates
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        this.#cacheCurrentPage();
        this.#prefetchAvailableColorVariants();
      }, { timeout: 50 });
    } else {
      // Safari fallback
      setTimeout(() => {
        this.#cacheCurrentPage();
        this.#prefetchAvailableColorVariants();
      }, 50);
    }
  }

  /**
   * Prefetches only available color variants for current size
   */
  #prefetchAvailableColorVariants() {
    const allInputs = this.querySelectorAll('input[type="radio"][data-option-value-id]');
    /** @type {{name: string, id: string | undefined, fieldset: string} | null} */
    let currentlySelected = null;
    
    allInputs.forEach((option, index) => {
      if (!(option instanceof HTMLInputElement)) return;
      
      const fieldset = option.closest('fieldset.variant-option');
      const fieldsetName = fieldset?.querySelector('.variant-option__name')?.textContent?.trim() || 'Unknown';
      const isColor = this.#isColorOption(option);
      
      // Track currently selected color
      if (option.checked && isColor) {
        currentlySelected = {
          name: option.value,
          id: option.dataset.optionValueId,
          fieldset: fieldsetName
        };
      }
      
      if (option.checked) return; // Skip currently selected
      
      if (!isColor) return;
      
      // Check if the color is visible on page (not hidden by Liquid)
      const label = option.closest('label');
      const isHidden = label && (
        label.classList.contains('variant-option__button-label--hidden') ||
        label.style.display === 'none'
      );
      
      if (isHidden) {
        // Don't prefetch hidden colors (no stock across all sizes OR no image)
        return;
      }
      
      // Check if this color is the same as currently selected color
      const isSameColorAsSelected = currentlySelected && option.value === currentlySelected.name;
      
      if (isSameColorAsSelected) {
        return; // Skip prefetch - same color image already on page
      }
      
      // Prefetch regardless of availability (as long as it's visible on page)
      const url = this.#buildHoverUrl(option);
      if (url && !this.#htmlCache.has(url)) {
        this.#prefetchSingleVariant(option);
      }
    });
  }

  /**
   * Prefetches a single variant HTML
   * @param {HTMLElement} option - The option element
   */
  async #prefetchSingleVariant(option) {
    try {
      // Build URL with the option as if it was selected
      const url = this.#buildHoverUrl(option);
      
      // Skip if already cached or being fetched
      if (!url || this.#htmlCache.has(url)) {
        return;
      }
      
            
      // Fetch and cache as text
      const response = await fetch(url);
      
      // Check for valid response
      if (!response.ok) {
        return;
      }
      
      const text = await response.text();
      
      // Validate response content
      if (!text || text.trim().length === 0) {
        return;
      }
      
      // Parse response and extract only the main element to reduce memory usage
      const parsedDoc = new DOMParser().parseFromString(text, 'text/html');
      const mainElement = parsedDoc.querySelector('main');
      
      if (!mainElement) {
        return;
      }
      
      // Store only the main element without wrapper (DOMParser will auto-wrap)
      const minimalHtml = mainElement.outerHTML;
      
      // Implement LRU: remove oldest entry if cache is full
      if (this.#htmlCache.size >= this.#MAX_CACHE_SIZE) {
        const firstKey = this.#htmlCache.keys().next().value;
        this.#htmlCache.delete(firstKey);
      }
      
      this.#htmlCache.set(url, minimalHtml);
      
    } catch (error) {
    }
  }

  /**
   * Builds URL for a variant option by replacing current selection
   * @param {HTMLElement} option - The variant option element
   * @returns {string} The URL with the specified option
   */
  #buildHoverUrl(option) {
    // Get the fieldset this option belongs to
    const fieldset = option.closest('fieldset');
    if (!fieldset) return this.buildRequestUrl(option);

    // Get all currently selected options
    const selectedOptions = Array.from(this.querySelectorAll('select option[selected], fieldset input:checked'));
    
    // Create array of option value IDs, replacing the one from same fieldset with target option
    const optionValueIds = selectedOptions
      .filter(opt => opt instanceof HTMLElement)
      .map(opt => {
        // If this option is from the same fieldset as target option, use target option's ID
        if (opt.closest('fieldset') === fieldset) {
          return option.dataset.optionValueId;
        }
        return opt.dataset.optionValueId;
      })
      .filter(id => id !== undefined);

    // If the target option's fieldset has no selected option yet, add it
    const hasFieldsetOption = selectedOptions.some(opt => opt.closest('fieldset') === fieldset);
    if (!hasFieldsetOption && option.dataset.optionValueId) {
      optionValueIds.push(option.dataset.optionValueId);
    }

    // Build URL with these option values
    let productUrl = option.dataset.connectedProductUrl || this.dataset.productUrl;
    const params = [];

    if (optionValueIds.length > 0) {
      params.push(`option_values=${optionValueIds.join(',')}`);
    }

    // Handle special cases
    if (this.closest('quick-add-component') || this.closest('swatches-variant-picker-component')) {
      if (productUrl?.includes('?')) {
        productUrl = productUrl.split('?')[0];
      }
      return `${productUrl}?section_id=section-rendering-product-card&${params.join('&')}`;
    }
    
    return `${productUrl}?${params.join('&')}`;
  }

  /**
   * Checks if an element is a color option
   * @param {HTMLElement} element
   * @returns {boolean}
   */
  #isColorOption(element) {
    const fieldset = element.closest('fieldset.variant-option');
    if (!fieldset) return false;
    
    const legend = fieldset.querySelector('.variant-option__name');
    if (!legend) return false;
    
    const optionName = legend.textContent?.toLowerCase() || '';
    return optionName.includes('color') || optionName.includes('colour') || optionName.includes('renk');
  }

  /**
   * Sets up event delegation listeners for variant hover interactions
   */
  setupVariantHoverListeners() {
    // Prevent duplicate listeners
    if (this.#listenersAttached) return;

    // Store bound handlers so they can be removed if needed
    const hoverHandler = this.handleVariantHover.bind(this);
    const leaveHandler = this.handleVariantLeave.bind(this);
    
    this.#boundHoverHandler = hoverHandler;
    this.#boundLeaveHandler = leaveHandler;

    // Use event delegation for better performance
    this.addEventListener('mouseenter', hoverHandler, true);
    this.addEventListener('mouseleave', leaveHandler, true);

    this.#listenersAttached = true;
  }
  
  /**
   * Unified hover handler using event delegation
   * @param {Event} event - The hover event
   */
  handleVariantHover(event) {
    const target = event.target;
    
    // Type guard for HTMLElement
    if (!(target instanceof HTMLElement)) return;
    
    // Check if target is a relevant element
    if (!this.isVariantElement(target)) return;
    
    const fieldset = target.closest('fieldset.variant-option, .variant-option--dropdowns');
    if (!fieldset) return;
    
    const variantName = this.getVariantName(target);
    if (!variantName) return;
    
    const swatchValue = fieldset.querySelector('.variant-option__swatch-value');
    if (swatchValue) {
      swatchValue.textContent = variantName;
    }
  }
  
  /**
   * Unified leave handler using event delegation
   * @param {Event} event - The leave event
   */
  handleVariantLeave(event) {
    const target = event.target;
    
    // Type guard for HTMLElement
    if (!(target instanceof HTMLElement)) return;
    
    if (!this.isVariantElement(target)) return;
    
    const fieldset = target.closest('fieldset.variant-option, .variant-option--dropdowns');
    if (!fieldset) return;
    
    const swatchValue = fieldset.querySelector('.variant-option__swatch-value');
    if (!swatchValue) return;
    
    // Reset to selected or default value
    const selectedName = this.getSelectedVariantName(fieldset);
    swatchValue.textContent = selectedName;
  }
  
  /**
   * Check if element is a variant-related element
   * @param {HTMLElement} element - Element to check
   * @returns {boolean}
   */
  isVariantElement(element) {
    if (!element.matches) return false;
    
    return element.matches('input[type="radio"][data-option-value-id], .variant-option__button-label, select');
  }
  
  /**
   * Extract variant name from different element types
   * @param {HTMLElement} element - The element to extract name from
   * @returns {string} - The variant name
   */
  getVariantName(element) {
    // Handle radio inputs
    if (element instanceof HTMLInputElement && element.type === 'radio') {
      return element.value;
    }
    
    // Handle button labels
    if (element.classList.contains('variant-option__button-label')) {
      const input = element.querySelector('input[type="radio"]');
      if (input instanceof HTMLInputElement) {
        return input.value;
      }
      return element.textContent ? element.textContent.trim() : '';
    }
    
    if (element instanceof HTMLSelectElement) {
      // For select elements during hover, we should get the option being hovered over
      // This requires different handling as select hover behavior is complex
    const hoveredOption = element.querySelector('option:hover');
    if (hoveredOption?.textContent) {
      return hoveredOption.textContent.replace(' - Unavailable', '').trim();
    }
      return '';
    }
    
    // Fallback
    return element.textContent ? element.textContent.trim() : '';
  }
  
  /**
   * Get the currently selected variant name from fieldset
   * @param {Element} fieldset - The fieldset to search in
   * @returns {string} - The selected variant name
   */
  getSelectedVariantName(fieldset) {
    // Check for selected radio input
    const checkedInput = fieldset.querySelector('input:checked');
    if (checkedInput instanceof HTMLInputElement) {
      if (checkedInput.dataset.optionValueName) {
        return checkedInput.dataset.optionValueName;
      }
      return checkedInput.value || '';
    }
    
    // Check for selected option in select
    const selectedOption = fieldset.querySelector('option[selected]');
    if (selectedOption instanceof HTMLOptionElement) {
      return selectedOption.textContent ? selectedOption.textContent.trim() : '';
    }
    
    // Fallback to first available option
    const firstInput = fieldset.querySelector('input[type="radio"]');
    if (firstInput instanceof HTMLInputElement) {
      return firstInput.value || '';
    }
    
    const firstOption = fieldset.querySelector('option');
    if (firstOption instanceof HTMLOptionElement) {
      return firstOption.textContent ? firstOption.textContent.trim() : '';
    }
    
    return '';
  }
  


  /**
   * Handles the variant change event.
   * @param {Event} event - The variant change event.
   */
  variantChanged(event) {
    // What are we missing?
    // - need to support swatches potentially, we will need to check on what's needed for that.

    if (!(event.target instanceof HTMLElement)) return;

    this.updateSelectedOption(event.target);
    this.dispatchEvent(new VariantSelectedEvent({ id: event.target.dataset.optionValueId ?? '' }));

    const isOnProductPage =
      Theme.template.name === 'product' &&
      !event.target.closest('product-card') &&
      !event.target.closest('quick-add-dialog');

    // Morph the entire main content for combined listings child products, because changing the product
    // might also change other sections depending on recommendations, metafields, etc.
    const currentUrl = this.dataset.productUrl?.split('?')[0];
    const newUrl = event.target.dataset.connectedProductUrl;
    const loadsNewProduct = isOnProductPage && !!newUrl && newUrl !== currentUrl;

    // Check if we can use cached HTML for color changes
    const requestUrl = this.buildRequestUrl(event.target);
    const cachedHtmlText = this.#htmlCache.get(requestUrl);
    const isColorChange = this.#isColorOptionChange(event.target);
    
    if (cachedHtmlText && isOnProductPage && isColorChange) {
      
      // Parse cached HTML text into a fresh Document
      const cachedHtml = new DOMParser().parseFromString(cachedHtmlText, 'text/html');
      
      // Use cached HTML instead of fetching
      this.#updateWithCachedHtml(cachedHtml, loadsNewProduct, isColorChange);
      
      // Update URL
      const url = new URL(window.location.href);
      if (event.target.dataset.variantId) {
        url.searchParams.set('variant', event.target.dataset.variantId);
      } else {
        url.searchParams.delete('variant');
      }
      
      if (url.href !== window.location.href) {
        history.replaceState({}, '', url.toString());
      }
      
      return;
    }

    // Otherwise fetch as normal
    this.fetchUpdatedSection(requestUrl, loadsNewProduct, isColorChange);

    const url = new URL(window.location.href);

    if (isOnProductPage) {
      if (event.target.dataset.variantId) {
        url.searchParams.set('variant', event.target.dataset.variantId);
      } else {
        url.searchParams.delete('variant');
      }
    }

    // Change the path if the option is connected to another product via combined listing.
    if (loadsNewProduct) {
      url.pathname = newUrl;
    }

    if (url.href !== window.location.href) {
      history.replaceState({}, '', url.toString());
    }
  }

  /**
   * Updates the page with cached HTML
   * @param {Document} cachedHtml - The cached HTML document
   * @param {boolean} shouldMorphMain - Whether to morph the entire main content
   * @param {boolean} isColorChange - Whether this is a color option change
   */
  #updateWithCachedHtml(cachedHtml, shouldMorphMain = false, isColorChange = false) {
    // Defer is only useful for the initial rendering of the page. Remove it here.
    cachedHtml.querySelector('overflow-list[defer]')?.removeAttribute('defer');

    const textContent = cachedHtml.querySelector(`variant-picker script[type="application/json"]`)?.textContent;
    if (!textContent) return;

    if (shouldMorphMain) {
      this.updateMain(cachedHtml);
    } else {
      const newProduct = this.updateVariantPicker(cachedHtml);

      // We grab the variant object from the response and dispatch an event with it.
      if (this.selectedOptionId) {
        this.dispatchEvent(
          new VariantUpdateEvent(JSON.parse(textContent), this.selectedOptionId, {
            html: cachedHtml,
            productId: this.dataset.productId ?? '',
            newProduct,
          })
        );
      }
    }

    // Prefetch after size changes (not color changes - those use cache)
    if (!isColorChange) {
      this.#prefetchAfterSizeChange();
    }
  }

  /**
   * Updates the selected option.
   * @param {string | Element} target - The target element.
   */
  updateSelectedOption(target) {
    if (typeof target === 'string') {
      const targetElement = this.querySelector(`[data-option-value-id="${target}"]`);

      if (!targetElement) throw new Error('Target element not found');

      target = targetElement;
    }

    if (target instanceof HTMLInputElement) {
      target.checked = true;
    }

    if (target instanceof HTMLSelectElement) {
      const newValue = target.value;
      const newSelectedOption = Array.from(target.options).find((option) => option.value === newValue);

      if (!newSelectedOption) throw new Error('Option not found');

      for (const option of target.options) {
        option.removeAttribute('selected');
      }

      newSelectedOption.setAttribute('selected', 'selected');
    }
  }

  /**
   * Builds the request URL.
   * @param {HTMLElement} selectedOption - The selected option.
   * @param {string | null} [source] - The source.
   * @param {string[]} [sourceSelectedOptionsValues] - The source selected options values.
   * @returns {string} The request URL.
   */
  buildRequestUrl(selectedOption, source = null, sourceSelectedOptionsValues = []) {
    // this productUrl and pendingRequestUrl will be useful for the support of combined listing. It is used when a user changes variant quickly and those products are using separate URLs (combined listing).
    // We create a new URL and abort the previous fetch request if it's still pending.
    let productUrl = selectedOption.dataset.connectedProductUrl || this.#pendingRequestUrl || this.dataset.productUrl;
    this.#pendingRequestUrl = productUrl;
    const params = [];

    if (this.selectedOptionsValues.length && !source) {
      params.push(`option_values=${this.selectedOptionsValues.join(',')}`);
    } else if (source === 'product-card') {
      if (this.selectedOptionsValues.length) {
        params.push(`option_values=${sourceSelectedOptionsValues.join(',')}`);
      } else {
        params.push(`option_values=${selectedOption.dataset.optionValueId}`);
      }
    }

    // If variant-picker is a child of quick-add-component or swatches-variant-picker-component, we need to append section_id=section-rendering-product-card to the URL
    if (this.closest('quick-add-component') || this.closest('swatches-variant-picker-component')) {
      if (productUrl?.includes('?')) {
        productUrl = productUrl.split('?')[0];
      }
      return `${productUrl}?section_id=section-rendering-product-card&${params.join('&')}`;
    }
    return `${productUrl}?${params.join('&')}`;
  }

  /**
   * Fetches the updated section.
   * @param {string} requestUrl - The request URL.
   * @param {boolean} shouldMorphMain - If the entire main content should be morphed. By default, only the variant picker is morphed.
   * @param {boolean} isColorChange - Whether this is a color option change
   */
  fetchUpdatedSection(requestUrl, shouldMorphMain = false, isColorChange = false) {
    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    fetch(requestUrl, { signal: this.#abortController.signal })
      .then((response) => response.text())
      .then((responseText) => {
        this.#pendingRequestUrl = undefined;
        const html = new DOMParser().parseFromString(responseText, 'text/html');
        // Defer is only useful for the initial rendering of the page. Remove it here.
        html.querySelector('overflow-list[defer]')?.removeAttribute('defer');

        const textContent = html.querySelector(`variant-picker script[type="application/json"]`)?.textContent;
        if (!textContent) return;

        if (shouldMorphMain) {
          this.updateMain(html);
        } else {
          const newProduct = this.updateVariantPicker(html);

          // We grab the variant object from the response and dispatch an event with it.
          if (this.selectedOptionId) {
            this.dispatchEvent(
              new VariantUpdateEvent(JSON.parse(textContent), this.selectedOptionId, {
                html,
                productId: this.dataset.productId ?? '',
                newProduct,
              })
            );
          }
        }

        // Prefetch after size changes (not color changes - those use cache)
        if (!isColorChange) {
          this.#prefetchAfterSizeChange();
        }
      })
      .catch((error) => {
        if (error.name === 'AbortError') {
        } 
      });
  }

  /**
   * @typedef {Object} NewProduct
   * @property {string} id
   * @property {string} url
   */

  /**
   * Re-renders the variant picker.
   * @param {Document} newHtml - The new HTML.
   * @returns {NewProduct | undefined} Information about the new product if it has changed, otherwise undefined.
   */
  updateVariantPicker(newHtml) {
    /** @type {NewProduct | undefined} */
    let newProduct;

    const newVariantPickerSource = newHtml.querySelector(this.tagName.toLowerCase());

    if (!newVariantPickerSource) {
      throw new Error('No new variant picker source found');
    }

    // For combined listings, the product might have changed, so update the related data attribute.
    if (newVariantPickerSource instanceof HTMLElement) {
      const newProductId = newVariantPickerSource.dataset.productId;
      const newProductUrl = newVariantPickerSource.dataset.productUrl;

      if (newProductId && newProductUrl && this.dataset.productId !== newProductId) {
        newProduct = { id: newProductId, url: newProductUrl };
      }

      this.dataset.productId = newProductId;
      this.dataset.productUrl = newProductUrl;
    }

    morph(this, newVariantPickerSource);

    return newProduct;
  }

  /**
   * Re-renders the entire main content.
   * @param {Document} newHtml - The new HTML.
   */
  updateMain(newHtml) {
    const main = document.querySelector('main');
    const newMain = newHtml.querySelector('main');

    if (!main || !newMain) {
      throw new Error('No new main source found');
    }

    morph(main, newMain);
  }

  /**
   * Gets the selected option.
   * @returns {HTMLInputElement | HTMLOptionElement | undefined} The selected option.
   */
  get selectedOption() {
    const selectedOption = this.querySelector('select option[selected], fieldset input:checked');

    if (!(selectedOption instanceof HTMLInputElement || selectedOption instanceof HTMLOptionElement)) {
      return undefined;
    }

    return selectedOption;
  }

  /**
   * Gets the selected option ID.
   * @returns {string | undefined} The selected option ID.
   */
  get selectedOptionId() {
    const { selectedOption } = this;
    if (!selectedOption) return undefined;
    const { optionValueId } = selectedOption.dataset;

    if (!optionValueId) {
      throw new Error('No option value ID found');
    }

    return optionValueId;
  }

  /**
   * Gets the selected options values.
   * @returns {string[]} The selected options values.
   */
  get selectedOptionsValues() {
    /** @type HTMLElement[] */
    const selectedOptions = Array.from(this.querySelectorAll('select option[selected], fieldset input:checked'));

    return selectedOptions.map((option) => {
      const { optionValueId } = option.dataset;

      if (!optionValueId) throw new Error('No option value ID found');

      return optionValueId;
    });
  }

  /**
   * Checks if the variant change is a color option change
   * @param {HTMLElement} target - The target element
   * @returns {boolean} True if it's a color option change
   */
  #isColorOptionChange(target) {
    return this.#isColorOption(target);
  }
}

if (!customElements.get('variant-picker')) {
  customElements.define('variant-picker', VariantPicker);
}
