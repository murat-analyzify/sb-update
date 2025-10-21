import VariantPicker from '@theme/variant-picker';
import { Component } from '@theme/component';
import { debounce, isDesktopBreakpoint, mediaQueryLarge } from '@theme/utilities';
import { ThemeEvents, VariantSelectedEvent, VariantUpdateEvent, SlideshowSelectEvent } from '@theme/events';
import { morph } from '@theme/morph';

/**
 * A custom element that displays a product card.
 *
 * @typedef {object} Refs
 * @property {HTMLAnchorElement} productCardLink - The product card link element.
 * @property {import('slideshow').Slideshow} [slideshow] - The slideshow component.
 * @property {import('quick-add').QuickAddComponent} [quickAdd] - The quick add component.
 * @property {HTMLElement} [cardGallery] - The card gallery component.
 *
 * @extends {Component<Refs>}
 */
class ProductCard extends Component {
  requiredRefs = ['productCardLink'];

  get productPageUrl() {
    return this.refs.productCardLink.href;
  }

  #fetchProductPageHandler = () => {
    if (!this.refs.quickAdd?.cachedProductHtml) {
      this.refs.quickAdd?.fetchProductPage(this.productPageUrl);
    }
  };

  connectedCallback() {
    super.connectedCallback();

    const link = this.refs.productCardLink;
    if (!(link instanceof HTMLAnchorElement)) throw new Error('Product card link not found');
    this.#handleQuickAdd();

    this.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate);
    this.addEventListener(ThemeEvents.variantSelected, this.#handleVariantSelected);
    this.addEventListener(SlideshowSelectEvent.eventName, this.#handleSlideshowSelect);
    mediaQueryLarge.addEventListener('change', this.#handleQuickAdd);

    if (this.dataset.productVariantsSize === '1') return;

    link.addEventListener('click', this.navigateToProduct);

    // Initialize swatch functionality
    this.#initSwatches();

    // Preload the next image on the slideshow to avoid white flashes on previewImage
    setTimeout(() => {
      if (this.refs.slideshow?.isNested) {
        this.#preloadNextPreviewImage();
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.refs.productCardLink.removeEventListener('click', this.navigateToProduct);
  }

  #preloadNextPreviewImage() {
    const currentSlide = this.refs.slideshow?.slides?.[this.refs.slideshow?.current];
    currentSlide?.nextElementSibling?.querySelector('img[loading="lazy"]')?.removeAttribute('loading');
  }

  /**
   * Handles the quick add event.
   */
  #handleQuickAdd = () => {
    this.removeEventListener('pointerenter', this.#fetchProductPageHandler);

    if (isDesktopBreakpoint()) {
      this.addEventListener('pointerenter', this.#fetchProductPageHandler);
    }
  };

  /**
   * Handles the variant selected event.
   * @param {VariantSelectedEvent} event - The variant selected event.
   */
  #handleVariantSelected = (event) => {
    if (event.target !== this.variantPicker) {
      this.variantPicker?.updateSelectedOption(event.detail.resource.id);
    }
  };

  /**
   * Handles the variant update event.
   * Updates price, checks for unavailable variants, and updates product URL.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #handleVariantUpdate = (event) => {
    // Stop the event from bubbling up to the section, variant updates triggered from product cards are fully handled
    // by this component and should not affect anything outside the card.
    event.stopPropagation();

    this.updatePrice(event);
    this.#isUnavailableVariantSelected(event);
    this.#updateProductUrl(event);
    this.refs.quickAdd?.fetchProductPage(this.productPageUrl);

    if (event.target !== this.variantPicker) {
      this.variantPicker?.updateVariantPicker(event.detail.data.html);
    }

    this.#updateVariantImages();
    this.#previousSlideIndex = null;
  };

  /**
   * Updates the DOM with a new price.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  updatePrice(event) {
    const priceContainer = this.querySelectorAll(`product-price [ref='priceContainer']`)[1];
    const newPriceElement = event.detail.data.html.querySelector(`product-price [ref='priceContainer']`);

    if (newPriceElement && priceContainer) {
      morph(priceContainer, newPriceElement);
    }
  }

  /**
   * Updates the product URL based on the variant update event.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #updateProductUrl(event) {
    const anchorElement = event.detail.data.html?.querySelector('product-card a');
    const featuredMediaUrl = event.detail.data.html
      ?.querySelector('product-card-link')
      ?.getAttribute('data-featured-media-url');

    // If the product card is inside a product link, update the product link's featured media URL
    if (featuredMediaUrl && this.closest('product-card-link'))
      this.closest('product-card-link')?.setAttribute('data-featured-media-url', featuredMediaUrl);

    if (anchorElement instanceof HTMLAnchorElement) {
      // If the href is empty, don't update the product URL eg: unavailable variant
      if (anchorElement.getAttribute('href')?.trim() === '') return;

      this.refs.productCardLink.href = anchorElement.href;
    }
  }

  /**
   * Checks if an unavailable variant is selected.
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #isUnavailableVariantSelected(event) {
    const allVariants = /** @type {NodeListOf<HTMLInputElement>} */ (
      event.detail.data.html.querySelectorAll('input:checked')
    );

    for (const variant of allVariants) {
      this.#toggleAddToCartButton(variant.dataset.optionAvailable === 'true');
    }
  }

  /**
   * Toggles the add to cart button state.
   * @param {boolean} enable - Whether to enable or disable the button.
   */
  #toggleAddToCartButton(enable) {
    const addToCartButton = this.querySelector('.add-to-cart__button button');

    if (addToCartButton instanceof HTMLButtonElement) {
      addToCartButton.disabled = !enable;
    }
  }

  /**
   * Hide the variant images that are not for the selected variant.
   */
  #updateVariantImages() {
    const { slideshow } = this.refs;
    if (!this.variantPicker?.selectedOption) {
      return;
    }

    const selectedImageId = this.variantPicker?.selectedOption.dataset.optionMediaId;

    if (slideshow && selectedImageId) {
      const { slides = [] } = slideshow.refs;

      for (const slide of slides) {
        if (slide.getAttribute('variant-image') == null) continue;

        slide.hidden = slide.getAttribute('slide-id') !== selectedImageId;
      }
    }
  }

  /**
   * Gets all variant inputs.
   * @returns {NodeListOf<HTMLInputElement>} All variant input elements.
   */
  get allVariants() {
    return this.querySelectorAll('input[data-variant-id]');
  }

  /**
   * Gets the variant picker component.
   * @returns {VariantPicker | null} The variant picker component.
   */
  get variantPicker() {
    return this.querySelector('swatches-variant-picker-component');
  }
  /** @type {number | null} */
  #previousSlideIndex = null;

  /**
   * Handles the slideshow select event.
   * @param {SlideshowSelectEvent} event - The slideshow select event.
   */
  #handleSlideshowSelect = (event) => {
    if (event.detail.userInitiated) {
      this.#previousSlideIndex = event.detail.index;
    }
  };

  /**
   * Previews a variant.
   * @param {string} id - The id of the variant to preview.
   */
  previewVariant(id) {
    const { slideshow } = this.refs;

    if (!slideshow) return;

    this.resetVariant.cancel();
    slideshow.select({ id }, undefined, { animate: false });
  }

  /**
   * Previews the next image.
   * @param {PointerEvent} event - The pointer event.
   */
  previewImage(event) {
    const { slideshow } = this.refs;

    if (!slideshow || event.pointerType !== 'mouse') return;

    this.resetVariant.cancel();

    if (this.#previousSlideIndex != null && this.#previousSlideIndex > 0) {
      slideshow.select(this.#previousSlideIndex, undefined, { animate: false });
    } else {
      slideshow.next(undefined, { animate: false });
      setTimeout(() => this.#preloadNextPreviewImage());
    }
  }

  /**
   * Resets the image to the variant image.
   */
  resetImage() {
    const { slideshow } = this.refs;
    if (!this.variantPicker) {
      if (!slideshow) return;
      slideshow.previous(undefined, { animate: false });
    } else {
      this.#resetVariant();
    }
  }

  /**
   * Resets the image to the variant image.
   */
  #resetVariant = () => {
    const { slideshow } = this.refs;

    if (!slideshow) return;

    const defaultSlide = slideshow.defaultSlide;
    const slideId = defaultSlide?.getAttribute('slide-id');
    if (defaultSlide && slideshow.slides?.includes(defaultSlide) && slideId) {
      slideshow.select({ id: slideId }, undefined, { animate: false });
      return;
    } else if (!this.variantPicker?.selectedOption) {
      slideshow.previous(undefined, { animate: false });
      return;
    }

    const id = this.variantPicker.selectedOption.dataset.optionMediaId;
    if (!id) {
      slideshow.previous(undefined, { animate: false });
      return;
    }

    slideshow.select({ id }, undefined, { animate: false });
  };

  /**
   * Intercepts the click event on the product card anchor, we want
   * to use this to add an intermediate state to the history.
   * This intermediate state captures the page we were on so that we
   * navigate back to the same page when the user navigates back.
   * In addition to that it captures the product card anchor so that we
   * have the specific product card in view.
   *
   * @param {Event} event
   */
  navigateToProduct = (event) => {
    if (!(event.target instanceof HTMLAnchorElement)) return;

    const productCardAnchor = event.target.getAttribute('id');
    if (!productCardAnchor) return;

    const url = new URL(window.location.href);
    const parent = event.target.closest('li');
    url.hash = productCardAnchor;
    if (parent && parent.dataset.page) {
      url.searchParams.set('page', parent.dataset.page);
    }
    history.replaceState({}, '', url.toString());
  };

  /**
   * Resets the variant.
   */
  resetVariant = debounce(this.#resetVariant, 100);

  /**
   * Initialize swatch functionality for product cards
   */
  #initSwatches() {
    const swatchContainer = this.querySelector('.product-card__swatches');
    if (!swatchContainer) return;

    const swatches = swatchContainer.querySelectorAll('.product-card__swatch');
    let mainImage = /** @type {HTMLImageElement | null} */ (this.querySelector('.product-card__image'));
    
    // Try alternative selectors if first one doesn't work
    if (!mainImage) {
      mainImage = /** @type {HTMLImageElement | null} */ (this.querySelector('img'));
    }
    if (!mainImage) {
      mainImage = /** @type {HTMLImageElement | null} */ (this.querySelector('.product-card__gallery img'));
    }
    
    if (!mainImage || swatches.length === 0) return;

    // Store original image src
    this.#originalImageSrc = mainImage.src;

    // Preload all variant images for smooth switching
    this.#preloadVariantImages();

    // Initialize with correct active swatch for show_multiple_colors products
    this.#initializeActiveSwatch();

    // Add direct click listeners as backup
    swatches.forEach(swatch => {
      swatch.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        
        const mediaId = swatch.getAttribute('data-media-id');
        if (mediaId) {
          this.selectVariant(mediaId);
        }
      });
    });
  }

  /**
   * Select variant and update main image
   * @param {string} mediaId - The media ID of the variant image
   * @param {Event} [event] - The event object
   */
  selectVariant(mediaId, event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    const swatchContainer = this.querySelector('.product-card__swatches');
    let mainImage = /** @type {HTMLImageElement | null} */ (this.querySelector('.product-card__image:not(.product-card__image--hover)'));
    const hoverImage = /** @type {HTMLImageElement | null} */ (this.querySelector('.product-card__image--hover'));
    
    // Try alternative selectors if first one doesn't work for mainImage
    if (!mainImage) {
      mainImage = /** @type {HTMLImageElement | null} */ (this.querySelector('img'));
    }
    if (!mainImage) {
      mainImage = /** @type {HTMLImageElement | null} */ (this.querySelector('.product-card__gallery img'));
    }
    
    if (!swatchContainer || !mainImage) return;

    const swatches = swatchContainer.querySelectorAll('.product-card__swatch');
    const selectedSwatch = /** @type {HTMLElement | null} */ (
      swatchContainer.querySelector(`[data-media-id="${mediaId}"]`)
    );

    if (!selectedSwatch) return;

    // Remove active class from all swatches
    swatches.forEach(s => s.classList.remove('product-card__swatch--active'));
    
    // Add active class to selected swatch
    selectedSwatch.classList.add('product-card__swatch--active');
    
    // Get image URL and color from swatch data
    const newImageUrl = selectedSwatch.dataset.imageUrl;
    const newHoverImageUrl = selectedSwatch.dataset.hoverImageUrl;
    const colorName = selectedSwatch.dataset.color;
    
    // Update main image with smooth transition
    if (newImageUrl) {
      this.#updateImageSmooth(mainImage, newImageUrl, colorName || '');
    }

    if (hoverImage && newHoverImageUrl) {
      if (hoverImage.src !== newHoverImageUrl) {
        hoverImage.src = newHoverImageUrl;
        if (hoverImage.srcset) {
          hoverImage.srcset = '';
        }
        if (colorName) {
          const baseAlt = hoverImage.alt.split(' - ')[0];
          hoverImage.alt = `${baseAlt} - ${colorName}`;
        }
      }
    }

    // Update color display in product info if exists
    const colorElement = this.querySelector('.product-card__color');
    if (colorElement && colorName) {
      colorElement.textContent = colorName;
    }

    // Check the radio input
    const radioInput = /** @type {HTMLInputElement | null} */ (
      selectedSwatch.querySelector('input[type="radio"]')
    );
    if (radioInput) {
      radioInput.checked = true;
    }

    // Update product card link to point to selected variant
    const variantId = selectedSwatch.dataset.variantId;
    if (variantId) {
      this.#updateProductCardUrl(variantId);
      this.#updateProductPrice(variantId);
    }
  }

  /** @type {string | null} */
  #originalImageSrc = null;

  /** @type {Map<string, HTMLImageElement>} */
  #preloadedImages = new Map();

  /**
   * Preload all variant images for smooth switching
   */
  #preloadVariantImages() {
    const swatchContainer = this.querySelector('.product-card__swatches');
    if (!swatchContainer) return;

    const swatches = swatchContainer.querySelectorAll('.product-card__swatch');
    
    swatches.forEach(swatch => {
      const imageUrl = swatch.getAttribute('data-image-url');
      const mediaId = swatch.getAttribute('data-media-id');
      
      if (imageUrl && mediaId && !this.#preloadedImages.has(mediaId)) {
        const img = new Image();
        img.src = imageUrl;
        this.#preloadedImages.set(mediaId, img);
      }
    });
  }

  /**
   * Initialize the correct active swatch for show_multiple_colors products
   */
  #initializeActiveSwatch() {
    const swatchContainer = this.querySelector('.product-card__swatches');
    if (!swatchContainer) return;

    const activeVariantId = /** @type {HTMLElement} */ (swatchContainer).dataset.activeVariantId;
    if (!activeVariantId) return;

    // Find the swatch that matches the active variant
    const activeSwatch = swatchContainer.querySelector(`[data-variant-id="${activeVariantId}"]`);
    if (activeSwatch) {
      // Make sure only this swatch is active
      const allSwatches = swatchContainer.querySelectorAll('.product-card__swatch');
      allSwatches.forEach(s => s.classList.remove('product-card__swatch--active'));
      
      // Set this swatch as active
      activeSwatch.classList.add('product-card__swatch--active');
      
      // Update the radio input
      const radioInput = /** @type {HTMLInputElement | null} */ (
        activeSwatch.querySelector('input[type="radio"]')
      );
      if (radioInput) {
        radioInput.checked = true;
      }

      // For split by color products, also update the main image to match the active variant
      const imageUrl = /** @type {HTMLElement} */ (activeSwatch).dataset.imageUrl;
      const colorName = /** @type {HTMLElement} */ (activeSwatch).dataset.color;
      if (imageUrl) {
        let mainImage = /** @type {HTMLImageElement | null} */ (this.querySelector('.product-card__image'));
        
        // Try alternative selectors if first one doesn't work
        if (!mainImage) {
          mainImage = /** @type {HTMLImageElement | null} */ (this.querySelector('img'));
        }
        if (!mainImage) {
          mainImage = /** @type {HTMLImageElement | null} */ (this.querySelector('.product-card__gallery img'));
        }
        
        if (mainImage) {
          this.#updateImageSmooth(mainImage, imageUrl, colorName || '');
        }
      }
    }
  }

  /**
   * Update product card URL to point to selected variant
   * @param {string} variantId - The variant ID to navigate to
   */
  #updateProductCardUrl(variantId) {
    const productCardLink = this.refs.productCardLink;
    if (!productCardLink || !variantId) return;

    try {
      // Get current URL and update variant parameter
      const currentUrl = new URL(productCardLink.href);
      currentUrl.searchParams.set('variant', variantId);
      
      // Update the href
      productCardLink.href = currentUrl.toString();
      
    } catch (error) {
      console.warn('Failed to update product card URL:', error);
    }
  }

  /**
   * Update product card price when variant is selected
   * @param {string} variantId - The variant ID to get price from
   */
  #updateProductPrice(variantId) {
    const priceContainer = this.querySelector('.product-card__price');
    if (!priceContainer || !variantId) return;

    // Find the selected swatch to get price data
    const selectedSwatch = /** @type {HTMLElement | null} */ (this.querySelector(`[data-variant-id="${variantId}"]`));
    if (!selectedSwatch) return;

    const priceData = selectedSwatch.dataset.price;
    const comparePriceData = selectedSwatch.dataset.comparePrice;
    const priceRaw = selectedSwatch.dataset.priceRaw;
    const comparePriceRaw = selectedSwatch.dataset.comparePriceRaw;


    if (priceData) {
      // Update price display
      const priceElement = priceContainer.querySelector('.price');
      let comparePriceElement = priceContainer.querySelector('.compare-at-price');

      if (priceElement) {
        priceElement.textContent = priceData;
      }

      // Handle compare at price (sale price) using raw values for comparison
      if (comparePriceRaw && priceRaw && parseFloat(comparePriceRaw) > parseFloat(priceRaw)) {
        if (comparePriceElement) {
          comparePriceElement.textContent = comparePriceData || '';
          /** @type {HTMLElement} */ (comparePriceElement).style.display = '';
        } else {
          // Create compare price element if it doesn't exist
          const newComparePriceElement = document.createElement('s');
          newComparePriceElement.className = 'compare-at-price';
          newComparePriceElement.textContent = comparePriceData || '';
          
          // Find the ref="priceContainer" div and insert before price element
          const priceContainerDiv = priceContainer.querySelector('[ref="priceContainer"]') || priceContainer;
          const targetPriceElement = priceContainerDiv.querySelector('.price');
          
          if (targetPriceElement) {
            priceContainerDiv.insertBefore(newComparePriceElement, targetPriceElement);
          } else {
            priceContainerDiv.appendChild(newComparePriceElement);
          }
        }
      } else {
        // Hide compare price if not on sale
        if (comparePriceElement) {
          /** @type {HTMLElement} */ (comparePriceElement).style.display = 'none';
        }
      }
    }
  }

  /**
   * Update image with minimal transition
   * @param {HTMLImageElement} mainImage - The main product image
   * @param {string} newImageUrl - The new image URL
   * @param {string} colorName - The color name
   */
  #updateImageSmooth(mainImage, newImageUrl, colorName) {
    // If the image is already the same, don't do anything
    if (mainImage.src === newImageUrl) return;

    // Simple direct image change - no animations to prevent DOM thrashing
    mainImage.src = newImageUrl;
    
    // Clear srcset if it exists to prevent conflicts
    if (mainImage.srcset) {
      mainImage.srcset = '';
    }
    
    // Update alt text
    if (colorName) {
      const baseAlt = mainImage.alt.split(' - ')[0];
      mainImage.alt = `${baseAlt} - ${colorName}`;
    }
    
    // Remove any existing transitions that might cause issues
    mainImage.style.transition = '';
    mainImage.style.transform = '';
    mainImage.style.opacity = '';
  }
}

if (!customElements.get('product-card')) {
  customElements.define('product-card', ProductCard);
}

/**
 * A custom element that displays a variant picker with swatches.
 *
 * @typedef {object} SwatchesRefs
 * @property {HTMLElement} overflowList
 *
 * @extends {VariantPicker<SwatchesRefs>}
 */
class SwatchesVariantPickerComponent extends VariantPicker {
  /**
   * Shows all swatches.
   * @param {Event} [event] - The event that triggered the show all swatches.
   */
  showAllSwatches(event) {
    event?.preventDefault();

    const { overflowList } = this.refs;

    if (overflowList instanceof OverflowList) {
      overflowList.showAll();
    }
  }
}

if (!customElements.get('swatches-variant-picker-component')) {
  customElements.define('swatches-variant-picker-component', SwatchesVariantPickerComponent);
}
