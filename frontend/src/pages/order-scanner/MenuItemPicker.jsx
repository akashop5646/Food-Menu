import React from 'react';

function formatMoney(value) {
  const amount = Number(value || 0);
  return `\u20B9${amount.toFixed(2)}`;
}

export default function MenuItemPicker({
  menuItems,
  manualSearch,
  setManualSearch,
  manualOrderItems,
  setItemQuantity,
  catalogLoading,
  catalogError,
  onRetryCatalog
}) {
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div>
          <h4 className="font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest">Menu Items</h4>
          <p className="text-sm text-on-surface-variant/70 mt-1">Search and add directly from the current catalog.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <span className="material-symbols-outlined absolute left-3 top-3 text-on-surface-variant text-[18px]">search</span>
          <input
            type="text"
            value={manualSearch}
            onChange={(e) => setManualSearch(e.target.value)}
            placeholder="Search menu items..."
            className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl pl-10 pr-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm"
          />
        </div>
      </div>

      {catalogLoading ? (
        <div className="flex items-center justify-center py-16">
          <span className="material-symbols-outlined text-primary text-4xl animate-spin">progress_activity</span>
        </div>
      ) : catalogError ? (
        <div className="rounded-2xl border border-dashed border-error/20 bg-error/5 py-12 text-center text-error flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-5xl">warning</span>
          <p className="text-sm font-medium">Failed to load menu items.</p>
          <button
            type="button"
            onClick={onRetryCatalog}
            className="bg-error text-white px-4 py-2 rounded-xl text-xs uppercase tracking-wider font-label-caps hover:bg-error/95 transition-colors cursor-pointer"
          >
            Retry Loading
          </button>
        </div>
      ) : menuItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline-variant/20 bg-surface-container-high/40 py-16 text-center text-on-surface-variant/60">
          <span className="material-symbols-outlined text-5xl">restaurant_menu</span>
          <p className="mt-3 text-sm">No menu items match your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[560px] overflow-y-auto pr-1">
          {menuItems.map(item => {
            const qty = manualOrderItems[item._id] ? manualOrderItems[item._id].quantity : 0;
            return (
              <div key={item._id} className="rounded-2xl border border-outline-variant/20 bg-surface-container-high overflow-hidden shadow-sm">
                <div className="p-4 flex gap-4 items-start">
                  <div className="w-16 h-16 rounded-xl bg-surface-container-low overflow-hidden border border-outline-variant/10 shrink-0 flex items-center justify-center">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <span className="material-symbols-outlined text-primary/40">restaurant</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                      <div className="min-w-0">
                        <h5 className="font-semibold text-on-surface truncate">{item.name}</h5>
                        <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">{item.description || 'No description available.'}</p>
                      </div>
                      <div className="text-left sm:text-right shrink-0">
                        <div className="font-price-display text-primary font-semibold">{formatMoney(item.price)}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-[10px] uppercase tracking-widest text-on-surface-variant min-w-0">
                        {item.categories && item.categories.length > 0 ? item.categories.join(' · ') : 'Menu Item'}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                        <button
                          type="button"
                          onClick={() => setItemQuantity(item, -1)}
                          className="w-8 h-8 rounded-full border border-outline-variant/30 text-on-surface-variant hover:text-error hover:border-error/40 flex items-center justify-center cursor-pointer"
                          aria-label={`Remove one ${item.name}`}
                        >
                          <span className="material-symbols-outlined text-[18px]">remove</span>
                        </button>
                        <div className="min-w-8 text-center font-semibold text-on-surface px-1">{qty}</div>
                        <button
                          type="button"
                          onClick={() => setItemQuantity(item, 1)}
                          className="w-8 h-8 rounded-full bg-primary text-on-primary hover:opacity-90 flex items-center justify-center cursor-pointer"
                          aria-label={`Add one ${item.name}`}
                        >
                          <span className="material-symbols-outlined text-[18px]">add</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
