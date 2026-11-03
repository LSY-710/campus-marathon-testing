const { request, showError, formatDate, money } = require("../../utils/api");

Page({
  data: {
    events: [],
    loading: true,
  },

  onLoad() {
    this.loadEvents();
  },

  onShow() {
    if (this.data.events.length) this.loadEvents();
  },

  onPullDownRefresh() {
    this.loadEvents().finally(() => wx.stopPullDownRefresh());
  },

  async loadEvents() {
    this.setData({ loading: true });
    try {
      const payload = await request("/api/events?pageSize=20");
      const events = payload.items.map((event, index) => ({
        ...event,
        order: String(index + 1).padStart(2, "0"),
        dateText: formatDate(event.startsAt),
        monthText: `${new Date(event.startsAt).getMonth() + 1}月`,
        dayText: String(new Date(event.startsAt).getDate()).padStart(2, "0"),
        priceText: money(event),
        statusClass: `ui-pill-${event.status.toLowerCase()}`,
      }));
      this.setData({
        events,
        liveCount: events.filter((event) => event.status === "REGISTERING")
          .length,
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false });
      showError(error);
    }
  },

  openSearch() {
    wx.switchTab({ url: "/pages/events/events" });
  },

  openEvent(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },

  openAll() {
    wx.switchTab({ url: "/pages/events/events" });
  },

  openProfile() {
    wx.switchTab({ url: "/pages/profile/profile" });
  },
});
