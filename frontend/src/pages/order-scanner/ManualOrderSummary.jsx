import React from 'react';

function formatMoney(value) {
  const amount = Number(value || 0);
  return `\u20B9${amount.toFixed(2)}`;
}

export default function ManualOrderSummary({
  selectedTable,
  selectedLocation,
  manualItemCount,
  manualTotal,
  manualLineItems,
  onReview,
  isSubmitting
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="font-headline-sm text-xl text-on-surface">Order summary</h3>
        <p className="text-sm text-on-surface-variant mt-1">Review the ticket before sending it to Live KDS.</p>
      </div>

      <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-high p-4 space-y-3">
        <div className="flex justify-between items-center text-sm">
          <span className="text-on-surface-variant">Table</span>
          <span className="font-semibold text-on-surface">{selectedTable ? (selectedTable.name || `Table ${selectedTable.number}`) : 'None selected'}</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-on-surface-variant">Location</span>
          <span className="font-semibold text-on-surface">{selectedLocation ? selectedLocation.name : (selectedTable?.location || 'Not assigned')}</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-on-surface-variant">Items</span>
          <span className="font-semibold text-on-surface">{manualItemCount}</span>
        </div>
        <div className="flex justify-between items-center text-sm pt-2 border-t border-outline-variant/10">
          <span className="text-on-surface-variant">Total</span>
          <span className="font-price-display text-primary font-semibold">{formatMoney(manualTotal)}</span>
        </div>
      </div>

      <button
        type="button"
        disabled={isSubmitting || !selectedTable || manualLineItems.length === 0}
        onClick={onReview}
        className="w-full bg-gold-metallic text-on-primary-fixed h-12 py-0 rounded-xl font-label-caps text-[13px] uppercase tracking-widest gold-glow flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="material-symbols-outlined text-[18px]">visibility</span>
        Review Order
      </button>

      {manualLineItems.length > 0 && (
        <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-high p-4">
          <h4 className="font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest mb-3">Selected Items</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {manualLineItems.map(item => (
              <div key={item._id} className="flex justify-between items-center text-sm">
                <div className="min-w-0">
                  <span className="font-semibold text-on-surface">{item.quantity}x {item.name}</span>
                </div>
                <div className="text-on-surface-variant font-medium">{formatMoney(Number(item.price) * Number(item.quantity))}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
