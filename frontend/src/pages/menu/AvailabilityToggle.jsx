import React from 'react';

export default function AvailabilityToggle({ available, isPending, disabled, onClick, itemName }) {
  const isAvailable = available !== false;
  
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending || disabled}
      aria-label={`Toggle availability for ${itemName || 'item'}. Current state: ${isAvailable ? 'In Stock' : 'Out of Stock'}. Click to make ${isAvailable ? 'Out of Stock' : 'In Stock'}`}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-label-caps text-[11px] uppercase tracking-widest transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
        isAvailable 
          ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20' 
          : 'bg-error/10 text-error border border-error/30 hover:bg-error/20'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {isPending ? (
        <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
      ) : (
        <div className={`w-2 h-2 rounded-full ${isAvailable ? 'bg-primary' : 'bg-error'}`}></div>
      )}
      <span>{isAvailable ? 'In Stock' : 'Out of Stock'}</span>
    </button>
  );
}
