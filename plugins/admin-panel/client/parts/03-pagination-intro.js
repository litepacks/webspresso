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
    
    return m('.flex.items-center.justify-between.px-4.py-3.bg-white dark:bg-slate-800.border-t', [
      m('.text-sm.text-gray-700', [
        'Showing ',
        m('span.font-medium', ((page - 1) * perPage) + 1),
        ' to ',
        m('span.font-medium', Math.min(page * perPage, total)),
        ' of ',
        m('span.font-medium', total),
        ' results',
      ]),
      m('nav.flex.items-center.space-x-1', [
        // Previous button
        m('button.px-3.py-1.rounded.border.text-sm', {
          disabled: page <= 1,
          class: page <= 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-700 dark:hover:bg-slate-700',
          onclick: () => page > 1 && onPageChange(page - 1),
        }, '← Prev'),
        
        // Page numbers
        start > 1 ? [
          m('button.px-3.py-1.rounded.text-sm.text-gray-700 dark:text-slate-300.hover:bg-gray-100 dark:hover:bg-slate-700 dark:hover:bg-slate-700', {
            onclick: () => onPageChange(1),
          }, '1'),
          start > 2 ? m('span.px-2.text-gray-400', '...') : null,
        ] : null,
        
        ...pages.map(p => 
          m('button.px-3.py-1.rounded.text-sm', {
            class: p === page 
              ? 'bg-blue-600 text-white' 
              : 'text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-700 dark:hover:bg-slate-700',
            onclick: () => onPageChange(p),
          }, p)
        ),
        
        end < totalPages ? [
          end < totalPages - 1 ? m('span.px-2.text-gray-400', '...') : null,
          m('button.px-3.py-1.rounded.text-sm.text-gray-700 dark:text-slate-300.hover:bg-gray-100 dark:hover:bg-slate-700 dark:hover:bg-slate-700', {
            onclick: () => onPageChange(totalPages),
          }, totalPages),
        ] : null,
        
        // Next button
        m('button.px-3.py-1.rounded.border.text-sm', {
          disabled: page >= totalPages,
          class: page >= totalPages ? 'text-gray-300 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-700 dark:hover:bg-slate-700',
          onclick: () => page < totalPages && onPageChange(page + 1),
        }, 'Next →'),
      ]),
    ]);
  },
};
