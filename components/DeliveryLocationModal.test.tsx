// @vitest-environment jsdom
/**
 * FC 078 F1 evidence of «Where do we deliver?» (T2.6, T2.3): saved addresses for an account,
 * a postal code for anyone else, failures said and retried, and no postal code of the account
 * kept in the browser.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { syncHeaderUser } from '@/lib/account/headerSession';
import { listAddresses, updateAddress } from '@/lib/api/accountDataClient';
import { getDestinationStore } from '@/lib/cart/destinationStore';
import { DeliveryLocationModal } from './DeliveryLocationModal';

vi.mock('@/lib/account/headerSession', () => ({ syncHeaderUser: vi.fn() }));
vi.mock('@/lib/api/accountDataClient', () => ({
  listAddresses: vi.fn(),
  updateAddress: vi.fn(),
}));

const texts = getMessages('es-MX').header.delivery;
const list = vi.mocked(listAddresses);
const update = vi.mocked(updateAddress);
const sync = vi.mocked(syncHeaderUser);
const ok = <T,>(data: T) => ({ ok: true as const, data });
const no = { ok: false as const, reason: 'offline' } as never;

const address = (over: Record<string, unknown>) => ({
  id: 'a1',
  isDefault: false,
  isComplete: true,
  stateCode: 'ZAC',
  postalCode: '98000',
  label: null,
  street: 'Av. Hidalgo',
  ...over,
});
const book = (...items: unknown[]) => ok({ items, max: 5 }) as never;

const onClose = vi.fn();
const show = (signedIn: boolean) =>
  render(
    <DeliveryLocationModal
      texts={texts}
      exampleLabel="Ejemplo"
      signedIn={signedIn}
      accountHref="/cuenta/datos/"
      onClose={onClose}
    />
  );
const type = (value: string) =>
  fireEvent.change(
    screen.getByLabelText(texts.codeTitle, { selector: 'input' }),
    { target: { value } }
  );
const submit = () =>
  fireEvent.submit(screen.getByRole('form', { name: texts.codeTitle }));

/** jsdom has no <dialog> methods: showModal only has to open it, as the browser does. */
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = showModal;
  for (const mock of [list, update, sync, onClose, showModal]) mock.mockClear();
  sessionStorage.clear();
  getDestinationStore().setState(null);
});
afterEach(cleanup);

describe('the dialog of a visitor', () => {
  it('opens as a modal and keeps the typed postal code in the tab, and only its state in the cart', () => {
    show(false);
    expect(showModal).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog', { name: texts.title })).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: texts.manage })).toBeNull();
    type('00');
    submit();
    expect(screen.getByRole('alert').textContent).toBe(texts.invalidCode);
    type(' 98000 ');
    expect(screen.queryByRole('alert')).toBeNull();
    submit();
    expect(sessionStorage.getItem('yekora_delivery_place_v1')).toBe('98000');
    expect(getDestinationStore().getSnapshot()).toBe('ZAC');
    expect(JSON.stringify({ ...localStorage })).not.toContain('98000');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from its button and when the browser closes the dialog', () => {
    show(false);
    fireEvent.click(screen.getByRole('button', { name: texts.close }));
    fireEvent(screen.getByRole('dialog'), new Event('close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('the dialog of an account', () => {
  it('lists its addresses and makes the chosen one the default, keeping no postal code', async () => {
    list.mockResolvedValue(
      book(
        address({ id: 'a1', isDefault: true, label: 'Casa' }),
        address({
          id: 'a2',
          stateCode: 'JAL',
          postalCode: '44100',
          street: null,
        })
      )
    );
    show(true);
    expect(screen.getByText(texts.loading)).toBeTruthy();
    const chosen = await screen.findByRole('button', { name: /^Jal\. 44100/ });
    expect(
      screen.getByRole('button', { name: /Casa · Zac\. 98000/ }).textContent
    ).toContain(texts.current);
    expect(screen.queryByRole('form', { name: texts.codeTitle })).toBeNull();
    update.mockResolvedValueOnce(no);
    fireEvent.click(chosen);
    expect(await screen.findByText(texts.failedSave)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    update.mockResolvedValue(
      ok({ id: 'a2', isDefault: true, isComplete: true })
    );
    fireEvent.click(chosen);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(update).toHaveBeenLastCalledWith('a2', { isDefault: true });
    expect(sync).toHaveBeenCalled();
    expect(getDestinationStore().getSnapshot()).toBe('JAL');
    const kept = JSON.stringify([{ ...localStorage }, { ...sessionStorage }]);
    expect(kept).not.toContain('44100');
  });

  it('offers the postal code to an account with no address, with the way to its data', async () => {
    list.mockResolvedValue(book());
    show(true);
    await screen.findByRole('form', { name: texts.codeTitle });
    const link = screen.getByRole('link', { name: texts.manage });
    expect(link.getAttribute('href')).toBe('/cuenta/datos/');
    link.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  it('names an address of a state it does not know by its code', async () => {
    list.mockResolvedValue(book(address({ stateCode: 'XXX', street: null })));
    show(true);
    expect(
      await screen.findByRole('button', { name: /^XXX 98000/ })
    ).toBeTruthy();
  });

  it('says when the addresses cannot be read, and retries', async () => {
    list.mockResolvedValueOnce(no).mockResolvedValue(book(address({})));
    show(true);
    expect(await screen.findByText(texts.failedLoad)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: texts.retry }));
    expect(
      await screen.findByRole('button', { name: /Av\. Hidalgo/ })
    ).toBeTruthy();
  });
});
