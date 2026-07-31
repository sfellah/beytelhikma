import { h } from '../dom.js';
import { icon } from '../icons.js';
import { repository } from '../repository.js';

/**
 * Choix d'une collection où ranger des livres, avec création à la volée.
 * Résout l'identifiant retenu, ou `null` si l'utilisateur renonce.
 *
 * N'utilise pas `confirmDialog` : ce n'est pas une confirmation mais une
 * liste dont le contenu change pendant que la boîte est ouverte.
 */
export function pickCollection() {
  return new Promise((resolve) => {
    let settle = (value) => {
      settle = () => {};
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(value);
    };

    const onKey = (event) => {
      if (event.key === 'Escape') settle(null);
    };

    const list = h('div', { class: 'picker__list' });

    async function refresh() {
      const collections = await repository.getCollections();
      list.replaceChildren(
        ...(collections.length
          ? collections.map((entry) =>
              h(
                'button',
                { class: 'picker__item', onclick: () => settle(entry.id) },
                h('span', { class: 'truncate' }, entry.name),
                h('span', { class: 'label-sm muted' }, `${entry.bookCount}`),
              ),
            )
          : [h('p', { class: 'label-md muted' }, 'لا توجد مجموعات بعد.')]),
      );
    }

    const field = h('input', {
      type: 'text',
      class: 'picker__field',
      placeholder: 'مجموعة جديدة…',
      onkeydown: (event) => {
        if (event.key === 'Enter') create();
      },
    });

    async function create() {
      const name = field.value.trim();
      if (!name) return;
      const id = await repository.createCollection(name);
      settle(id);
    }

    const backdrop = h(
      'div',
      {
        class: 'modal',
        onclick: (event) => {
          if (event.target === backdrop) settle(null);
        },
      },
      h(
        'div',
        { class: 'modal__panel', role: 'dialog', 'aria-modal': 'true' },
        h('h3', { class: 'title-md' }, 'إضافة إلى مجموعة'),
        list,
        h(
          'div',
          { class: 'picker__create' },
          field,
          h('button', { class: 'button button--filled', onclick: create }, icon('plus', { size: 18 })),
        ),
        h(
          'div',
          { class: 'modal__actions' },
          h('button', { class: 'button button--tonal', onclick: () => settle(null) }, 'إلغاء'),
        ),
      ),
    );

    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    refresh().then(() => field.focus());
  });
}
