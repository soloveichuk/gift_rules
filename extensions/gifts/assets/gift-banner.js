(function() {
  'use strict';

  /**
   * Gift Banner Web Component
   * 
   * Manages gift banner display and gift application logic.
   * Uses Web Components API for better encapsulation and state management.
   */
  class GiftBanner extends HTMLElement {
    constructor() {
      super();
      
      // Bind methods to preserve 'this' context
      this.updateBanner = this.updateBanner.bind(this);
      this.applyGift = this.applyGift.bind(this);
      
      // Initialize component
      this.init();
    }

    /**
     * Initialize component - load settings, setup event listeners, and update banner
     */
    init() {
      this.loadSettings();
      this.setupEventListeners();
      this.setupApplyButton();
      this.updateBanner();
    }

    /**
     * Load settings from element attributes
     * Web Components use attributes instead of data-* for better API
     */
    loadSettings() {
      const minSubtotal = parseFloat(this.getAttribute('min-subtotal') || '0');
      this.minSubtotalCents = minSubtotal * 100;
      this.isRuleEnabled = this.getAttribute('is-rule-enabled') !== 'false';
      this.eligibleText = this.getAttribute('eligible-text') || '🎁 Gift will be added automatically';
      this.progressText = this.getAttribute('progress-text') || 'Add products worth {{ amount }} to get a gift';
      this.lastState = null;
    }

    /**
     * Get child elements using querySelector (more reliable than storing references)
     */
    get textElement() {
      return this.querySelector('.gift-banner__text');
    }

    get messageElement() {
      return this.querySelector('.gift-banner__message');
    }

    /**
     * Setup global cart fetch listener to update banner when cart changes
     * Uses closure to maintain reference to this component instance
     */
    setupEventListeners() {
      if (window.__cartFetchPatched) return;
      window.__cartFetchPatched = true;
    
      const originalFetch = window.fetch;
      let lastCartToken = null;
      const componentInstances = new WeakSet();
    
      // Store this instance for cart updates
      componentInstances.add(this);
    
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
    
        try {
          const [input] = args;
          const url = typeof input === 'string' ? input : input.url;
    
          if (!url || !url.includes('/cart/')) return response;
    
          if (!response.ok) return response;
    
          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('application/json')) return response;
    
          const cart = await response.clone().json();
    
          const token = cart.items
            ?.map(i => `${i.id}:${i.quantity}`)
            .join('|');
    
          if (token !== lastCartToken) {
            lastCartToken = token;
            // Update all gift-banner components on the page
            document.querySelectorAll('gift-banner').forEach((component) => {
              if (component.updateBanner) {
                component.updateBanner();
              }
            });
          }
        } catch (e) {
          console.log('Error fetching cart:', e);
        }
    
        return response;
      };
    }    

    async getCartState() {
      try {
        const response = await fetch('/cart.js');
        if (!response.ok) {
          throw new Error('Failed to fetch cart');
        }
        const cart = await response.json();
        return {
          totalPrice: cart.total_price || 0,
        };
      } catch (error) {
        console.error('Error fetching cart:', error);
        return {
          totalPrice: 0,
        };
      }
    }

    formatMoney(cents) {
      if (window.Shopify?.formatMoney) {
        return window.Shopify.formatMoney(cents);
      }

      const amount = (cents / 100).toFixed(2);
      const currency = window.Shopify?.currency?.active || 'USD';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
      }).format(parseFloat(amount));
    }

    calculateState(cartTotalCents) {
      const isEligible = cartTotalCents >= this.minSubtotalCents;
      const remainingCents = Math.max(0, this.minSubtotalCents - cartTotalCents);
      
      return {
        isEligible,
        remainingCents,
      };
    }

    async updateBanner() {
      if (!this.isRuleEnabled) {
        this.hideBanner();
        return;
      }

      const cartState = await this.getCartState();
      const state = this.calculateState(cartState.totalPrice);

      // Skip update if state hasn't changed
      if (this.lastState && 
          this.lastState.isEligible === state.isEligible && 
          this.lastState.remainingCents === state.remainingCents) {
        return;
      }

      this.lastState = state;
      this.renderBanner(state.isEligible, state.remainingCents);
    }

    /**
     * Render banner based on eligibility state
     * Updates Web Component's internal state and DOM
     */
    renderBanner(isEligible, remainingCents) {
      if (!this.textElement || !this.messageElement) return;

      // Update Web Component attribute for state tracking
      if (isEligible) {
        this.setAttribute('is-eligible', '');
        this.messageElement.className = 'gift-banner__message gift-banner__message--eligible';
        this.textElement.textContent = this.eligibleText;
      } else {
        this.removeAttribute('is-eligible');
        this.messageElement.className = 'gift-banner__message gift-banner__message--progress';
        const remainingAmount = this.formatMoney(remainingCents);
        const text = this.progressText.replace('{{ amount }}', remainingAmount);
        this.textElement.textContent = text;
      }

      this.style.display = 'block';
    }

    /**
     * Hide banner
     */
    hideBanner() {
      this.style.display = 'none';
    }

    /**
     * Setup apply button and auto-apply logic
     * Button is inside the web component, so we can query it directly
     */
    setupApplyButton() {
      // Find apply button within this web component
      const applyButton = this.querySelector('[data-gift-apply-button]');
      
      if (applyButton) {
        applyButton.addEventListener('click', () => {
          this.applyGift();
        });
      }

      // Auto-apply on load if eligible
      this.autoApplyOnLoad();
    }

    async autoApplyOnLoad() {
      // Wait a bit for cart to be ready
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const cartState = await this.getCartState();
      const state = this.calculateState(cartState.totalPrice);
      
      // Auto-apply if eligible and rule is enabled
      if (state.isEligible && this.isRuleEnabled) {
        console.log('[Gift Banner] Auto-applying gift on load');
        await this.applyGift(true); // true = silent mode (no status display)
      }
    }

    getStatusFromResult(result) {
      if (result.applied) {
        return 'applied';
      }
      
      if (result.reason?.includes('already added to cart') || 
          result.reason?.includes('already in cart')) {
        return 'already exists';
      }
      
      if (result.reason?.includes('less than minimum') || 
          result.reason?.includes('not eligible')) {
        return 'not eligible';
      }
      
      return 'error';
    }

    /**
     * Show status message to user
     * Uses Web Component's innerHTML for better DOM management
     */
    showStatus(status, message) {
      // Remove existing status element
      const existingStatus = this.querySelector('.gift-banner__status');
      if (existingStatus) {
        existingStatus.remove();
      }

      // Create status element
      const statusElement = document.createElement('div');
      statusElement.className = `gift-banner__status gift-banner__status--${status}`;
      
      const statusText = {
        'applied': '✅ Gift applied successfully!',
        'already exists': 'ℹ️ Gift already in cart',
        'not eligible': '⚠️ Cart total is below minimum',
        'loading': '⏳ Applying gift...',
        'error': `❌ ${message || 'Failed to apply gift'}`
      };
      
      statusElement.textContent = statusText[status] || statusText['error'];
      
      // Insert after banner message
      if (this.messageElement) {
        this.messageElement.parentNode.insertBefore(statusElement, this.messageElement.nextSibling);
      }
      
      // Auto-hide status after 5 seconds (except for errors)
      if (status !== 'error') {
        setTimeout(() => {
          if (statusElement.parentNode) {
            statusElement.remove();
          }
        }, 5000);
      }
    }

    async applyGift(silent = false) {
      try {
        // Show loading state
        if (!silent) {
          this.showStatus('loading', 'Applying gift...');
        }

        // Get cart ID from cart.js
        const cartResponse = await fetch('/cart.js');
        if (!cartResponse.ok) {
          throw new Error('Failed to fetch cart');
        }
        const cart = await cartResponse.json();

        // Cart ID is the token in Shopify
        const cartId = cart.token;
        if (!cartId) {
          throw new Error('Cart ID not found');
        }

        // Get shop domain
        let shop = window.Shopify?.shop;
        if (!shop) {
          const hostname = window.location.hostname;
          if (hostname.includes('myshopify.com')) {
            shop = hostname.replace('.myshopify.com', '');
          } else {
            shop = hostname;
          }
        }

        // Make request to API
        // Use app proxy path: /apps/embedded/app/gift/apply
        const apiUrl = `/apps/embedded/app/gift/apply`;
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': '69420'
          },
          body: JSON.stringify({ cartId: cartId }),
        });

        const result = await response.json();

        // Determine status from result
        const status = this.getStatusFromResult(result);

        if (!silent) {
          this.showStatus(status, result.reason);
        }

        // Reload cart if gift was applied or removed
        if (result.applied || result.removed) {
          // Small delay to show status before reload
          setTimeout(() => {
            window.location.reload();
          }, silent ? 0 : 1000);
        } else {
          console.log('[Gift Apply] Status:', status, result.reason);
        }
      } catch (error) {
        console.error('Error applying gift:', error);
        if (!silent) {
          this.showStatus('error', error.message || 'Failed to apply gift');
        }
      }
    }
  }

  /**
   * Register Web Component
   * This makes <gift-banner> a valid HTML element
   */
  if (!customElements.get('gift-banner')) {
    customElements.define('gift-banner', GiftBanner);
  }
})();

