import React from 'react';

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
  clearManualOrder
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
      <div className="flex-1">
        <h3 className="font-headline-sm text-xl text-on-surface">Manual order composer</h3>
        <p className="text-sm text-on-surface-variant mt-1">
          Start with a table, confirm the location, then build the ticket from the items already in your menu.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Select Table</label>
            <select
              value={selectedTableId}
              onChange={(e) => selectTable(e.target.value)}
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-base md:text-sm"
            >
              <option value="" disabled>Select a table</option>
              {tables.map(table => (
                <option key={table._id} value={table._id}>
                  {table.name || `Table ${table.number}`} {table.locationName || table.location ? `- ${table.locationName || table.location}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Location</label>
            <select
              value={selectedLocationId}
              onChange={(e) => setSelectedLocationId(e.target.value)}
              className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-xl px-4 py-3 focus:border-primary focus:ring-1 focus:ring-primary outline-none text-base md:text-sm"
            >
              <option value="">Use table location</option>
              {locations.map(location => (
                <option key={location._id} value={location._id}>{location.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
            <span className="block text-[10px] uppercase tracking-widest text-on-surface-variant">Table</span>
            <div className="mt-1 text-sm text-on-surface font-semibold">
              {selectedTable ? (selectedTable.name || `Table ${selectedTable.number}`) : 'No table selected'}
            </div>
          </div>
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
            <span className="block text-[10px] uppercase tracking-widest text-on-surface-variant">Location</span>
            <div className="mt-1 text-sm text-on-surface font-semibold">
              {selectedLocation ? selectedLocation.name : (selectedTable?.location || 'Not assigned')}
            </div>
          </div>
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
            <span className="block text-[10px] uppercase tracking-widest text-on-surface-variant">Items</span>
            <div className="mt-1 text-sm text-on-surface font-semibold">
              {manualItemCount} selected
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={clearManualOrder}
        className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-error px-3 py-2 rounded-lg text-[11px] uppercase tracking-widest font-label-caps shrink-0"
      >
        Clear Items
      </button>
    </div>
  );
}
