// Pagination Component
const Pagination = {
  view: (vnode) => {
    const { page, totalPages, total, perPage, onPageChange } = vnode.attrs;
    if (totalPages <= 1) return null;
    
    const pages = [];
    const maxVisible = 5;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);
    if (end - start < maxVisible - 1) {
      start = Math.max(1, end - maxVisible + 1);
    }
    
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    
    return m('.flex.flex-col.sm:flex-row.items-center.justify-between.gap-3.px-4.py-3.bg-white.dark:bg-slate-800.border-t.border-gray-200.dark:border-slate-700', [
      m('.text-xs.sm:text-sm.text-gray-600.dark:text-slate-400.text-center.sm:text-left', [
        'Showing ',
        m('span.font-semibold.text-gray-900.dark:text-slate-200', ((page - 1) * perPage) + 1),
        ' to ',
        m('span.font-semibold.text-gray-900.dark:text-slate-200', Math.min(page * perPage, total)),
        ' of ',
        m('span.font-semibold.text-gray-900.dark:text-slate-200', total),
        ' results',
      ]),
      m('nav.flex.items-center.gap-1', [
        // Previous button
        m('button.px-3.py-1.5.rounded-lg.border.border-gray-200.dark:border-slate-600.text-xs.sm:text-sm.font-medium.transition-colors', {
          disabled: page <= 1,
          class: page <= 1 
            ? 'text-gray-300 dark:text-slate-600 cursor-not-allowed bg-gray-50 dark:bg-slate-900/50' 
            : 'text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 bg-white dark:bg-slate-800',
          onclick: () => page > 1 && onPageChange(page - 1),
        }, '← Prev'),

        // Mobile page indicator
        m('span.sm:hidden.px-2.text-xs.font-medium.text-gray-600.dark:text-slate-400', `${page} / ${totalPages}`),
        
        // Page numbers (desktop only)
        start > 1 ? [
          m('button.hidden.sm:inline-flex.px-3.py-1.5.rounded-lg.text-xs.sm:text-sm.font-medium.text-gray-700.dark:text-slate-300.hover:bg-gray-100.dark:hover:bg-slate-700.transition-colors', {
            onclick: () => onPageChange(1),
          }, '1'),
          start > 2 ? m('span.hidden.sm:inline-flex.px-1.text-gray-400.dark:text-slate-500', '...') : null,
        ] : null,
        
        ...pages.map(p => 
          m('button.hidden.sm:inline-flex.px-3.py-1.5.rounded-lg.text-xs.sm:text-sm.font-medium.transition-colors', {
            class: p === page 
              ? 'bg-blue-600 dark:bg-blue-500 text-white shadow-sm' 
              : 'text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700',
            onclick: () => onPageChange(p),
          }, p)
        ),
        
        end < totalPages ? [
          end < totalPages - 1 ? m('span.hidden.sm:inline-flex.px-1.text-gray-400.dark:text-slate-500', '...') : null,
          m('button.hidden.sm:inline-flex.px-3.py-1.5.rounded-lg.text-xs.sm:text-sm.font-medium.text-gray-700.dark:text-slate-300.hover:bg-gray-100.dark:hover:bg-slate-700.transition-colors', {
            onclick: () => onPageChange(totalPages),
          }, totalPages),
        ] : null,
        
        // Next button
        m('button.px-3.py-1.5.rounded-lg.border.border-gray-200.dark:border-slate-600.text-xs.sm:text-sm.font-medium.transition-colors', {
          disabled: page >= totalPages,
          class: page >= totalPages 
            ? 'text-gray-300 dark:text-slate-600 cursor-not-allowed bg-gray-50 dark:bg-slate-900/50' 
            : 'text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 bg-white dark:bg-slate-800',
          onclick: () => page < totalPages && onPageChange(page + 1),
        }, 'Next →'),
      ]),
    ]);
  },
};
