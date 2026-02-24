/**
 * Admin Panel Menu Component Tests
 * Tests for sidebar, mobile hamburger menu, and layout generation
 */

const { generateMenuComponent, registerSystemMenuItems } = require('../../../plugins/admin-panel/modules/menu');

describe('Menu Component Generation', () => {
  let code;

  beforeAll(() => {
    code = generateMenuComponent();
  });

  it('should return a non-empty string', () => {
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
  });

  describe('Icon Component', () => {
    it('should define the Icon component', () => {
      expect(code).toContain('const Icon');
    });

    it('should include menu icon SVG path for hamburger', () => {
      expect(code).toContain('menu:');
      expect(code).toContain('M4 6h16M4 12h16M4 18h16');
    });

    it('should include x icon SVG path for close button', () => {
      expect(code).toContain("x:");
      expect(code).toContain('M6 18L18 6M6 6l12 12');
    });
  });

  describe('MenuItem Component', () => {
    it('should define the MenuItem component', () => {
      expect(code).toContain('const MenuItem');
    });

    it('should close sidebar on menu item click', () => {
      expect(code).toContain('sidebarOpen = false');
    });

    it('should set route on click', () => {
      expect(code).toContain('m.route.set(item.path)');
    });
  });

  describe('MenuGroup Component', () => {
    it('should define the MenuGroup component', () => {
      expect(code).toContain('const MenuGroup');
    });

    it('should support collapsing', () => {
      expect(code).toContain('collapsed');
    });
  });

  describe('Mobile Hamburger Menu', () => {
    it('should define global sidebarOpen state', () => {
      expect(code).toContain('var sidebarOpen = false');
    });

    it('should define MobileHeader component', () => {
      expect(code).toContain('const MobileHeader');
    });

    it('should show hamburger button that opens sidebar', () => {
      const mobileHeaderIdx = code.indexOf('const MobileHeader');
      const mobileHeaderEnd = code.indexOf('};', mobileHeaderIdx + 100);
      const mobileHeaderCode = code.substring(mobileHeaderIdx, mobileHeaderEnd);

      expect(mobileHeaderCode).toContain('sidebarOpen = true');
      expect(mobileHeaderCode).toContain("name: 'menu'");
    });

    it('should hide MobileHeader on large screens (lg:hidden)', () => {
      expect(code).toContain('lg:hidden.fixed.top-0.left-0.right-0.h-14');
    });

    it('should display Admin title in mobile header', () => {
      const mobileHeaderIdx = code.indexOf('const MobileHeader');
      const mobileHeaderEnd = code.indexOf('};', mobileHeaderIdx + 100);
      const mobileHeaderCode = code.substring(mobileHeaderIdx, mobileHeaderEnd);

      expect(mobileHeaderCode).toContain("'Admin'");
    });
  });

  describe('Sidebar Component', () => {
    it('should define the Sidebar component', () => {
      expect(code).toContain('const Sidebar');
    });

    it('should include backdrop overlay for mobile', () => {
      expect(code).toContain('bg-black.bg-opacity-50.z-30.lg:hidden');
    });

    it('should toggle sidebar visibility based on sidebarOpen state', () => {
      expect(code).toContain("sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'");
    });

    it('should apply transition for smooth open/close animation', () => {
      expect(code).toContain('transition-transform.duration-200');
    });

    it('should include close button visible only on mobile', () => {
      expect(code).toContain('lg:hidden');
      const sidebarIdx = code.indexOf('const Sidebar');
      const sidebarCode = code.substring(sidebarIdx);
      expect(sidebarCode).toContain("name: 'x'");
    });

    it('should close sidebar when backdrop is clicked', () => {
      const backdropMatch = code.indexOf('bg-black.bg-opacity-50');
      const nextOnclick = code.indexOf('sidebarOpen = false', backdropMatch);
      expect(nextOnclick).toBeGreaterThan(backdropMatch);
      expect(nextOnclick - backdropMatch).toBeLessThan(100);
    });

    it('should close sidebar when logo is clicked', () => {
      const sidebarIdx = code.indexOf('const Sidebar');
      const sidebarCode = code.substring(sidebarIdx);
      const logoOnclick = sidebarCode.indexOf("e.preventDefault(); sidebarOpen = false; m.route.set('/')");
      expect(logoOnclick).toBeGreaterThan(-1);
    });

    it('should close sidebar on logout', () => {
      const logoutIdx = code.indexOf("api.post('/auth/logout')");
      const afterLogout = code.substring(logoutIdx, logoutIdx + 200);
      expect(afterLogout).toContain('sidebarOpen = false');
    });

    it('should have fixed positioning with z-index layering', () => {
      expect(code).toContain('.z-40.transition-transform');
      expect(code).toContain('.z-30.lg:hidden');
      expect(code).toContain('.z-20');
    });
  });

  describe('Layout Component', () => {
    it('should define the Layout component', () => {
      expect(code).toContain('const Layout');
    });

    it('should include MobileHeader in layout', () => {
      const layoutIdx = code.indexOf('const Layout');
      const layoutCode = code.substring(layoutIdx);
      expect(layoutCode).toContain('m(MobileHeader)');
    });

    it('should include Sidebar in layout', () => {
      const layoutIdx = code.indexOf('const Layout');
      const layoutCode = code.substring(layoutIdx);
      expect(layoutCode).toContain('m(Sidebar)');
    });

    it('should apply responsive margin and padding to main content', () => {
      expect(code).toContain('lg:ml-64.p-6.pt-20.lg:pt-6');
    });

    it('should not apply left margin on mobile (no ml-64 without lg prefix)', () => {
      expect(code).toContain('lg:ml-64');
      expect(code).not.toContain("'main.ml-64");
    });

    it('should add extra top padding on mobile for the header (pt-20)', () => {
      expect(code).toContain('pt-20');
    });
  });
});

describe('registerSystemMenuItems', () => {
  it('should register dashboard menu item', () => {
    const registry = {
      registerMenuItem: vi.fn(),
      registerMenuGroup: vi.fn(),
    };

    registerSystemMenuItems({ registry });

    expect(registry.registerMenuItem).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'dashboard',
        label: 'Dashboard',
        path: '/',
        icon: 'home',
      })
    );
  });

  it('should register system menu group', () => {
    const registry = {
      registerMenuItem: vi.fn(),
      registerMenuGroup: vi.fn(),
    };

    registerSystemMenuItems({ registry });

    expect(registry.registerMenuGroup).toHaveBeenCalledWith('system', expect.objectContaining({
      label: 'System',
      icon: 'settings',
    }));
  });
});
