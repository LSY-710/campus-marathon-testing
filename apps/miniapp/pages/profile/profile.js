const { request, showError, formatDate } = require("../../utils/api");

const registrationStatusLabels = {
  WAIT_PAYMENT: "待缴费",
  REGISTERED: "已报名",
  COMPLETED: "已完赛",
  CANCELLED: "已取消",
};

Page({
  data: {
    user: null,
    profileInitial: "",
    registrations: [],
    visibleRegistrations: [],
    certificates: [],
    activeTab: "ALL",
    tabs: [
      { key: "ALL", label: "全部" },
      { key: "WAIT_PAYMENT", label: "待缴费" },
      { key: "REGISTERED", label: "已报名" },
    ],
  },

  onShow() {
    this.loadProfile();
  },

  async loadProfile() {
    const app = getApp();
    if (!app.globalData.token) {
      this.setData({ user: null, registrations: [], certificates: [] });
      return;
    }
    try {
      const [me, registrations, certificates] = await Promise.all([
        request("/api/me"),
        request("/api/me/registrations"),
        request("/api/me/certificates"),
      ]);
      this.setData({
        user: me.user,
        profileInitial: me.user.nickname.slice(0, 1),
        registrations: registrations.items.map((item) => ({
          ...item,
          dateText: formatDate(item.eventStartsAt),
          statusLabel: registrationStatusLabels[item.status] || item.status,
          statusClass:
            item.status === "WAIT_PAYMENT"
              ? "ui-pill-upcoming"
              : item.status === "COMPLETED"
                ? "ui-pill-registered"
                : "ui-pill-registering",
        })),
        certificates: certificates.items.map((item) => ({
          ...item,
          dateText: formatDate(item.issuedAt),
        })),
        registeredCount: registrations.items.filter((item) =>
          ["REGISTERED", "COMPLETED"].includes(item.status),
        ).length,
        completedCount: registrations.items.filter(
          (item) => item.status === "COMPLETED",
        ).length,
      }, () => this.updateVisibleRegistrations());
    } catch (error) {
      showError(error);
    }
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/login" });
  },

  selectTab(event) {
    this.setData(
      { activeTab: event.currentTarget.dataset.key },
      () => this.updateVisibleRegistrations(),
    );
  },

  updateVisibleRegistrations() {
    const activeTab = this.data.activeTab;
    this.setData({
      visibleRegistrations:
        activeTab === "ALL"
          ? this.data.registrations
          : this.data.registrations.filter((item) => item.status === activeTab),
    });
  },

  openEvent(event) {
    wx.navigateTo({
      url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}`,
    });
  },

  openCertificates() {
    wx.navigateTo({ url: "/pages/certificates/certificates" });
  },

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "确认退出当前账号？",
      success: (result) => {
        if (result.confirm) {
          getApp().clearSession();
          this.setData({ user: null, registrations: [], certificates: [] });
        }
      },
    });
  },
});
