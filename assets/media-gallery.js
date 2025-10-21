import { Component } from '@theme/component';
import { ThemeEvents, VariantUpdateEvent, ZoomMediaSelectedEvent } from '@theme/events';

/**
 * A custom element that renders a media gallery.
 *
 * @typedef {object} Refs
 * @property {import('./zoom-dialog').ZoomDialog} [zoomDialogComponent] - The zoom dialog component.
 * @property {import('./slideshow').Slideshow} [slideshow] - The slideshow component.
 * @property {HTMLElement[]} [media] - The media elements.
 *
 * @extends Component<Refs>
 */
export class MediaGallery extends Component {
  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#controller;
    const target = this.closest('.shopify-section, dialog');

    target?.addEventListener(ThemeEvents.variantUpdate, this.#handleVariantUpdate, { signal });
    this.refs.zoomDialogComponent?.addEventListener(ThemeEvents.zoomMediaSelected, this.#handleZoomMediaSelected, {
      signal,
    });
    
    // Lazy loading: filter images after page load
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        this.#filterMediaImages(this);
      }, { timeout: 100 });
    } else {
      // Safari fallback
      setTimeout(() => {
        this.#filterMediaImages(this);
      }, 100);
    }
  }

  #controller = new AbortController();

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#controller.abort();
  }
  
  /**
   * Filters media images - optimized version
   * @param {Element} container - Container holding media elements
   */
  #filterMediaImages(container) {
    // Find zoom-dialog once (for performance)
    const zoomDialog = container.querySelector('zoom-dialog');
    
    // Select all media elements once
    const allMediaElements = container.querySelectorAll('[ref="media[]"]');
    /** @type {Element[]} */
    const galleryMediaElements = [];
    
    // Filter main gallery media (in a single loop)
    allMediaElements.forEach((media) => {
      if (!zoomDialog || !zoomDialog.contains(media)) {
        galleryMediaElements.push(media);
      }
    });
    
    if (galleryMediaElements.length === 0) {
      this.classList.add('filtered');
      return;
    }
    
    /** @type {Map<string, Array<{element: Element, index: number}>>} */
    const fileNameToElements = new Map();
    
    // Collect file names and save with their indices
    galleryMediaElements.forEach((media, index) => {
      const img = media.querySelector('img');
      if (!img) return;
      
      const src = img.getAttribute('src');
      if (!src) return;
      
      const fileName = src.split('/').pop()?.split('?')[0];
      if (!fileName) return;
      
      if (!fileNameToElements.has(fileName)) {
        fileNameToElements.set(fileName, []);
      }
      fileNameToElements.get(fileName)?.push({ element: media, index });
    });
    
    if (fileNameToElements.size === 0) {
      this.classList.add('filtered');
      return;
    }
    
    const fileNames = Array.from(fileNameToElements.keys());
    const shortestFileName = fileNames.reduce((shortest, current) => 
      current.length < shortest.length ? current : shortest
    );
    
    const shortestNameWithoutExt = shortestFileName.split('.')[0] || shortestFileName;
    
    // Track indices to be hidden
    const hiddenIndices = new Set();
    
    // Apply filtering in the main gallery
    fileNameToElements.forEach((items, fileName) => {
      if (fileName !== shortestFileName && fileName.includes(shortestNameWithoutExt)) {
        items.forEach(({ element, index }) => {
          if (element instanceof HTMLElement) {
            element.style.display = 'none';
            element.setAttribute('aria-hidden', 'true');
            hiddenIndices.add(index);
          }
        });
      }
      else if (items.length > 1) {
        // Hide all except the first one
        items.slice(1).forEach(({ element, index }) => {
          if (element instanceof HTMLElement) {
            element.style.display = 'none';
            element.setAttribute('aria-hidden', 'true');
            hiddenIndices.add(index);
          }
        });
      }
    });
    
    // If zoom-dialog exists, also hide media and thumbnails at the same indices
    if (zoomDialog && hiddenIndices.size > 0) {
      const zoomMediaElements = zoomDialog.querySelectorAll('[ref="media[]"]');
      const thumbnails = zoomDialog.querySelectorAll('.dialog-thumbnails-list button');
      
      hiddenIndices.forEach(index => {
        const zoomMedia = zoomMediaElements[index];
        if (zoomMedia instanceof HTMLElement) {
          zoomMedia.style.display = 'none';
          zoomMedia.setAttribute('aria-hidden', 'true');
        }
        
        const thumbnail = thumbnails[index];
        if (thumbnail instanceof HTMLElement) {
          thumbnail.style.display = 'none';
          thumbnail.setAttribute('aria-hidden', 'true');
        }
      });
    }
    
    // Calculate visible media count and update layout class
    const visibleCount = galleryMediaElements.length - hiddenIndices.size;
    
    // Remove any existing count classes
    this.classList.remove('media-gallery--single-media', 'media-gallery--multiple-media');
    
    // Add appropriate class based on visible count
    if (visibleCount === 1) {
      this.classList.add('media-gallery--single-media');
    } else if (visibleCount > 1) {
      this.classList.add('media-gallery--multiple-media');
    }
    
    this.classList.add('filtered');
  }

  /**
   * Handles a variant update event by replacing the current media gallery with a new one.
   *
   * @param {VariantUpdateEvent} event - The variant update event.
   */
  #handleVariantUpdate = (event) => {
    const source = event.detail?.data?.html;

    if (!source) return;
    const newMediaGallery = source.querySelector('media-gallery');
    
    if (!newMediaGallery) return;

    // connectedCallback of the new element will handle filtering
    this.replaceWith(newMediaGallery);
  };

  /**
   * Handles the 'zoom-media:selected' event.
   * @param {ZoomMediaSelectedEvent} event - The zoom-media:selected event.
   */
  #handleZoomMediaSelected = async (event) => {
    this.slideshow?.select(event.detail.index, undefined, { animate: false });
  };

  /**
   * Zooms the media gallery.
   *
   * @param {number} index - The index of the media to zoom.
   * @param {PointerEvent} event - The pointer event.
   */
  zoom(index, event) {
    this.refs.zoomDialogComponent?.open(index, event);
  }

  get slideshow() {
    return this.refs.slideshow;
  }

  get media() {
    return this.refs.media;
  }

  get presentation() {
    return this.dataset.presentation;
  }
}

if (!customElements.get('media-gallery')) {
  customElements.define('media-gallery', MediaGallery);
}
