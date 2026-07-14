import React, { useMemo } from 'react';

export default function ManualOrderBuilder({
  tables,
  locations,
  selectedTableId,
  selectedLocationId,
  selectedTable,
  selectedLocation,
  manualItemCount,
  selectTable,
  setSelectedLocationId,
  clearManualOrder,
  getTableDisplayLabel,
  getTableSortKey
}) {
  const sortedTables = useMemo(() => {
    return [...tables].sort((a, b) => {
      const aKey = getTableSortKey(a);
      const bKey = getTableSortKey(b);

      if (aKey !== bKey) {
        return aKey - bKey;
      }

      return getTableDisplayLabel(a).localeCompare(
        getTableDisplayLabel(b),
        undefined,
        { numeric: true, sensitivity: 'base' }
      );
    });
  }, [tables, getTableSortKey, getTableDisplayLabel]);

  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 md:gap-4">
      <div className="flex-1 min-w-0">
        <h3 className="font-headline-sm text-lg md:text-xl text-on-surface">Manual order composer</h3>
        <p className="text-sm text-on-surface-variant mt-0.5 md:mt-1 line-clamp-3 md:line-clamp-none">
          Start with a table, confirm the location, then build the ticket from the items already in your menu.
        </p>

        <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3 md:gap-4 mt-3 md:mt-5">
          <div className="min-w-0">
            <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1 md:mb-1.5 uppercase tracking-wider">Location</label>
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              className="w-full min-w-0 bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl px-3 md:px-4 py-2.5 md:py-3 min-h-11 md:min-h-0 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-base md:text-sm"
            >
              <option value="">Use table location</option>
              {locations.map(location => (
                <option key={location._id} value={location._id}>{location.name}</option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1 md:mb-1.5 uppercase tracking-wider">Select Table</label>
            <select
              value={selectedTableId}
              onChange={(e) => selectTable(e.target.value)}
              disabled={Boolean(selectedLocationId && tables.length === 0)}
              className="w-full min-w-0 bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl px-3 md:px-4 py-2.5 md:py-3 min-h-11 md:min-h-0 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-base md:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {selectedLocationId && tables.length === 0 ? (
                <option value="">No tables available in this location</option>
              ) : (
                <>
                  <option value="" disabled>Select a table</option>
                  {sortedTables.map(table => (
                    <option key={table._id} value={table._id}>
                      {getTableDisplayLabel(table)}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3 md:mt-5">
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-2.5 md:p-4 min-w-0" title={selectedTable ? (selectedTable.name || `Table ${selectedTable.number}`) : 'No table selected'}>
            <span className="block text-[9px] md:text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Table</span>
            <div className="mt-0.5 md:mt-1 text-xs md:text-sm text-on-surface font-semibold truncate">
              {selectedTable ? (selectedTable.name || `Table ${selectedTable.number}`) : 'None'}
            </div>
          </div>
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-2.5 md:p-4 min-w-0" title={selectedLocation ? selectedLocation.name : (selectedTable?.location || 'Not assigned')}>
            <span className="block text-[9px] md:text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Location</span>
            <div className="mt-0.5 md:mt-1 text-xs md:text-sm text-on-surface font-semibold truncate">
              {selectedLocation ? selectedLocation.name : (selectedTable?.location || 'None')}
            </div>
          </div>
          <div className={`rounded-xl border p-2.5 md:p-4 min-w-0 transition-colors ${manualItemCount > 0 ? 'bg-primary/5 border-primary/20' : 'bg-surface-container-high border-outline-variant/15'}`}>
            <span className={`block text-[9px] md:text-[10px] uppercase tracking-widest font-bold ${manualItemCount > 0 ? 'text-primary' : 'text-on-surface-variant'}`}>Items</span>
            <div className={`mt-0.5 md:mt-1 text-xs md:text-sm font-semibold truncate ${manualItemCount > 0 ? 'text-primary' : 'text-on-surface'}`}>
              {manualItemCount > 0 ? `${manualItemCount} items` : '0 items'}
            </div>
          </div>
        </div>

        {/* Mobile-only Clear Items Action */}
        {manualItemCount > 0 && (
          <div className="flex md:hidden justify-end mt-2">
            <button
              type="button"
              onClick={clearManualOrder}
              aria-label="Clear all selected items"
              className="flex items-center gap-1.5 text-xs text-error hover:opacity-90 min-h-11 px-3 py-1 bg-error/5 border border-error/15 rounded-xl font-medium"
            >
              <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
              Clear Items
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={clearManualOrder}
        disabled={manualItemCount === 0}
        aria-label="Clear all selected items"
        className="hidden md:block bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-error px-3 py-2 rounded-lg text-[11px] uppercase tracking-widest font-label-caps shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Clear Items
      </button>
    </div>
  );
}
