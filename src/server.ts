import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { prisma } from './lib/prisma.js';
import { sendSms, sendBulkSms, getAfroMessageAccountStatus } from './lib/afromessage.js';
import { normalizeEthiopianPhone, isValidEthiopianPhone, displayEthiopianPhone } from './lib/phone.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Haile Borito & Ertib API',
    timestamp: new Date().toISOString(),
  });
});

// ----------------------------------------------------
// 1. MENU ENDPOINTS
// ----------------------------------------------------
app.get('/api/menu', async (req: Request, res: Response) => {
  try {
    const items = await prisma.menuItem.findMany({
      orderBy: { price: 'asc' },
    });
    res.json({ success: true, count: items.length, data: items });
  } catch (error: any) {
    console.error('Error fetching menu:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 2. ORDER ENDPOINTS
// ----------------------------------------------------

// Get all orders (with optional status filter)
app.get('/api/orders', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status && typeof status === 'string' && status !== 'ALL') {
      where.status = status.toUpperCase();
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        items: true,
        smsLogs: {
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, count: orders.length, data: orders });
  } catch (error: any) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new order
app.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const {
      customerName,
      customerPhone,
      orderType = 'PICKUP',
      deliveryAddress,
      notes,
      items,
    } = req.body;

    if (!customerName || !customerPhone || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required order details (customerName, customerPhone, items)',
      });
    }

    const normalizedPhone = normalizeEthiopianPhone(customerPhone);
    if (!isValidEthiopianPhone(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Ethiopian phone number. Please enter a valid number (e.g. 0911234567 or 0711234567)',
      });
    }

    // Calculate total amount
    let calculatedTotal = 0;
    const orderItemsData = items.map((item: any) => {
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const unitPrice = Number(item.unitPrice) || 0;
      const totalPrice = unitPrice * quantity;
      calculatedTotal += totalPrice;

      return {
        menuItemId: item.menuItemId || null,
        itemName: item.itemName || 'Food Item',
        quantity,
        unitPrice,
        totalPrice,
      };
    });

    // Generate readable order number: HBE-XXXX (e.g. HBE-4892)
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const orderNumber = `HBE-${randomSuffix}`;

    // Upsert customer record
    const customer = await prisma.customer.upsert({
      where: { phone: normalizedPhone },
      update: {
        name: customerName,
        totalOrders: { increment: 1 },
        totalSpent: { increment: calculatedTotal },
      },
      create: {
        name: customerName,
        phone: normalizedPhone,
        totalOrders: 1,
        totalSpent: calculatedTotal,
      },
    });

    // Create order with items
    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId: customer.id,
        customerName,
        customerPhone: normalizedPhone,
        orderType,
        deliveryAddress: deliveryAddress || null,
        notes: notes || null,
        totalAmount: calculatedTotal,
        status: 'PENDING',
        items: {
          create: orderItemsData,
        },
      },
      include: {
        items: true,
      },
    });

    // Automatically trigger AfroMessage Confirmation SMS
    const itemsSummary = order.items.map((i) => `${i.quantity}x ${i.itemName}`).join(', ');
    const smsMessage = `Selam ${customerName}! Your order #${orderNumber} (${itemsSummary}) at Haile Borito & Ertib has been received and is being prepared. Total: ${calculatedTotal} ETB. Delivery/Type: ${orderType}. Ameseginalen!`;

    const smsResult = await sendSms({
      to: normalizedPhone,
      message: smsMessage,
      triggerType: 'ORDER_CONFIRMATION',
      orderId: order.id,
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: order,
      sms: smsResult,
    });
  } catch (error: any) {
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update order status
app.patch('/api/orders/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['PENDING', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];
    if (!status || !validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Valid values: ${validStatuses.join(', ')}`,
      });
    }

    const newStatus = status.toUpperCase();

    // Check existing order
    const existingOrder = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: { status: newStatus },
      include: { items: true },
    });

    let smsResult = null;

    // Requirement: Auto-trigger SMS on status change to "Ready"
    if (newStatus === 'READY' && existingOrder.status !== 'READY') {
      const isDelivery = updatedOrder.orderType === 'DELIVERY';
      const actionText = isDelivery
        ? 'is dispatched and on its way to your address!'
        : 'is HOT & READY for pickup at our counter!';

      const readyMessage = `Selam ${updatedOrder.customerName}! Your order #${updatedOrder.orderNumber} at Haile Borito & Ertib ${actionText} Enjoy your meal! 🌯🍲`;

      smsResult = await sendSms({
        to: updatedOrder.customerPhone,
        message: readyMessage,
        triggerType: 'ORDER_READY',
        orderId: updatedOrder.id,
      });
    }

    res.json({
      success: true,
      message: `Order status updated to ${newStatus}`,
      data: updatedOrder,
      sms: smsResult,
    });
  } catch (error: any) {
    console.error('Error updating order status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 3. CUSTOMER CONTACT BOOK ENDPOINTS
// ----------------------------------------------------

// Get all customers
app.get('/api/customers', async (req: Request, res: Response) => {
  try {
    const { search } = req.query;
    let where: any = {};

    if (search && typeof search === 'string') {
      where = {
        OR: [
          { name: { contains: search } },
          { phone: { contains: search } },
        ],
      };
    }

    const customers = await prisma.customer.findMany({
      where,
      orderBy: { totalOrders: 'desc' },
      include: {
        _count: { select: { orders: true } },
      },
    });

    res.json({ success: true, count: customers.length, data: customers });
  } catch (error: any) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add customer manually
app.post('/api/customers', async (req: Request, res: Response) => {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ success: false, error: 'Name and phone are required' });
    }

    const normalizedPhone = normalizeEthiopianPhone(phone);
    if (!isValidEthiopianPhone(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Ethiopian phone format. Must be a valid 09... or 07... number',
      });
    }

    const existing = await prisma.customer.findUnique({
      where: { phone: normalizedPhone },
    });

    if (existing) {
      const updated = await prisma.customer.update({
        where: { phone: normalizedPhone },
        data: { name },
      });
      return res.json({
        success: true,
        message: 'Customer already exists; name updated',
        data: updated,
      });
    }

    const newCustomer = await prisma.customer.create({
      data: {
        name,
        phone: normalizedPhone,
        totalOrders: 0,
        totalSpent: 0,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Customer added to contact book',
      data: newCustomer,
    });
  } catch (error: any) {
    console.error('Error adding customer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 4. AFROMESSAGE SMS & BROADCAST ENDPOINTS
// ----------------------------------------------------

// Send SMS (Single or Bulk)
app.post('/api/sms/send', async (req: Request, res: Response) => {
  try {
    const { recipientType, phone, message, triggerType = 'BROADCAST' } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({ success: false, error: 'Message text cannot be empty' });
    }

    if (recipientType === 'ALL_CUSTOMERS') {
      // Bulk broadcast to all stored customers
      const customers = await prisma.customer.findMany({
        select: { phone: true, name: true },
      });

      if (customers.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No customers found in contact book to send broadcast to.',
        });
      }

      const phoneList = customers.map((c) => c.phone);
      const nameMap: Record<string, string> = {};
      customers.forEach((c) => {
        nameMap[c.phone] = c.name;
      });

      const broadcastResult = await sendBulkSms(phoneList, message, triggerType, nameMap);

      return res.json({
        success: true,
        message: `Broadcast completed: ${broadcastResult.sent} sent, ${broadcastResult.failed} failed`,
        data: broadcastResult,
      });
    }

    // Single recipient
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Recipient phone number is required' });
    }

    const normalizedPhone = normalizeEthiopianPhone(phone);
    if (!isValidEthiopianPhone(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Ethiopian phone format (e.g. 0911234567 or 0711234567)',
      });
    }

    const singleResult = await sendSms({
      to: normalizedPhone,
      message,
      triggerType: triggerType || 'MANUAL',
    });

    res.json({
      success: singleResult.success,
      message: singleResult.success ? 'SMS sent successfully' : 'SMS dispatch encountered an issue',
      data: singleResult,
    });
  } catch (error: any) {
    console.error('Error in SMS send route:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fetch recent SMS logs
app.get('/api/sms/logs', async (req: Request, res: Response) => {
  try {
    const logs = await prisma.smsLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        order: {
          select: { orderNumber: true, customerName: true },
        },
      },
    });

    res.json({ success: true, count: logs.length, data: logs });
  } catch (error: any) {
    console.error('Error fetching SMS logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check AfroMessage API account status & balance
app.get('/api/sms/balance', async (req: Request, res: Response) => {
  try {
    const status = await getAfroMessageAccountStatus();
    res.json({ success: true, data: status });
  } catch (error: any) {
    console.error('Error checking AfroMessage balance:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 5. OWNER ADMIN METRICS & PIN
// ----------------------------------------------------

// Verify Admin PIN
app.post('/api/admin/verify-pin', (req: Request, res: Response) => {
  const { pin } = req.body;
  const configuredPin = process.env.ADMIN_PIN || '1234';

  if (pin === configuredPin) {
    return res.json({ success: true, authenticated: true });
  }
  res.status(401).json({ success: false, authenticated: false, error: 'Incorrect owner PIN' });
});

// Get overall stats for Admin dashboard
app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [totalOrders, todayOrders, pendingOrders, totalCustomers, totalSmsLogs] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.customer.count(),
      prisma.smsLog.count(),
    ]);

    const revenueResult = await prisma.order.aggregate({
      _sum: { totalAmount: true },
      where: { status: { not: 'CANCELLED' } },
    });

    const totalRevenue = revenueResult._sum.totalAmount || 0;

    res.json({
      success: true,
      data: {
        totalOrders,
        todayOrders,
        pendingOrders,
        totalCustomers,
        totalSmsLogs,
        totalRevenue,
      },
    });
  } catch (error: any) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`=================================================`);
  console.log(`🇪🇹 Haile Borito & Ertib API Server Running`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`📱 AfroMessage Mode: ${process.env.AFROMESSAGE_API_TOKEN?.includes('mock') ? 'SIMULATED / SANDBOX' : 'LIVE'}`);
  console.log(`=================================================`);
});
