import React from 'react';

export default function MenuEmptyState({ type, onAction, errorMessage }) {
  if (type === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-surface-container-low rounded-xl border border-error/20 p-6 text-center animate-[fadeUp_0.8s_ease-out_forwards]">
        <span className="material-symbols-outlined text-error text-5xl mb-4">error</span>
        <h3 className="font-headline-sm text-on-surface text-[20px] mb-2">Failed to Load Menu</h3>
        <p className="font-body-md text-on-surface-variant max-w-md mb-4 text-sm">
          {errorMessage || "We ran into an issue retrieving the menu items. Please check your connection and try again."}
        </p>
        <button
          onClick={onAction}
          className="bg-primary text-on-primary font-title-md text-[14px] font-semibold px-6 py-2.5 rounded-xl gold-glow flex items-center gap-2 transition-all"
        >
          <span className="material-symbols-outlined text-[20px]">refresh</span>
          <span>Try Again</span>
        </button>
      </div>
    );
  }

  if (type === 'no-results') {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-surface-container-low rounded-xl border border-outline-variant/20 p-6 text-center animate-[fadeUp_0.8s_ease-out_forwards]">
        <span className="material-symbols-outlined text-on-surface-variant/60 text-5xl mb-4">search_off</span>
        <h3 className="font-headline-sm text-on-surface text-[20px] mb-1">No Matching Items</h3>
        <p className="font-body-md text-on-surface-variant max-w-md mb-4 text-sm">
          No menu items match your active search, category, or availability filters.
        </p>
        <button
          onClick={onAction}
          className="text-primary text-xs font-label-caps uppercase tracking-wider hover:underline"
        >
          Clear Filters
        </button>
      </div>
    );
  }

  // default: fully empty menu
  return (
    <div className="flex flex-col items-center justify-center py-20 bg-surface-container-low rounded-xl border border-outline-variant/20 p-6 text-center animate-[fadeUp_0.8s_ease-out_forwards]">
      <span className="material-symbols-outlined text-primary text-6xl mb-4">restaurant_menu</span>
      <h3 className="font-headline-sm text-on-surface text-[22px] mb-2">Your Menu is Empty</h3>
      <p className="font-body-md text-on-surface-variant max-w-sm mb-6 text-sm">
        Start building your premium digital menu by adding your very first food item.
      </p>
      <button
        onClick={onAction}
        className="bg-primary text-on-primary font-title-md text-[14px] font-semibold px-6 py-2.5 rounded-xl gold-glow flex items-center gap-2 transition-all"
      >
        <span className="material-symbols-outlined text-[20px]">add</span>
        <span>Add First Item</span>
      </button>
    </div>
  );
}
